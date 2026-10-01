/**
 * session.ts — one request-owned server render.
 *
 * Every renderer (string, DOM, result, stream) shares this lifecycle:
 * create request runtimes → scope them → prepare the route → mount →
 * optionally settle data → serialize → dispose. The session owns one
 * AbortController that merges the caller's signal, the routed request's
 * signal, and explicit aborts (stream reader cancellation, deadlines), and
 * propagates it into route preparation and data settlement. Disposal runs
 * exactly once and always releases route and data runtimes; the application
 * runtime is released too unless a successful `renderWithDom*()` hands it to
 * its caller.
 */

import {
  createApplicationRuntime,
  runWithApplicationRuntime,
  unregisterSubtree,
  type ApplicationRuntime,
  type DocumentLike,
} from '@memoized-dom/runtime/server';
import {
  createMemoryRouteHistory,
  createRouteRuntime,
  runWithRouteRuntime,
  type RouteRuntime,
} from '@memoized-dom/router';
import {
  prepareInitialRoutedRuntime,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
} from '@memoized-dom/router/internal';
import {
  createDataRuntime,
  runWithDataRuntime,
  type DataRuntime,
} from '@memoized-dom/data';
import type { RenderOptions, RenderPayload } from './index';
import { serverRootId, type ServerComponent } from './root-id';

/**
 * How data settlement concluded:
 * - `shell`: no settlement requested; pending UI was serialized as-is.
 * - `complete`: every in-flight request settled within the budget.
 * - `timeout`: the budget elapsed; still-pending UI was serialized.
 */
export type RenderSettlement =
  | { readonly status: 'shell' }
  | { readonly status: 'complete' | 'timeout'; readonly settleMs: number };

export interface SessionTier {
  readonly mode: 'server-string' | 'server-dom';
  readonly document: DocumentLike;
  /** A successful render hands its application runtime to the caller. */
  readonly callerOwnsRuntime?: boolean;
}

const DEFAULT_SETTLE_TIMEOUT = 5000;
const SHELL: RenderSettlement = Object.freeze({ status: 'shell' });
let sessionSequence = 0;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Server render aborted', 'AbortError');
}

export class RenderSession {
  readonly applicationRuntime: ApplicationRuntime;
  readonly routeRuntime: RouteRuntime;
  readonly dataRuntime: DataRuntime;
  readonly rootId: string;
  settlement: RenderSettlement = SHELL;

  private readonly controller = new AbortController();
  private readonly unlinkSignals: Array<() => void> = [];
  private retained = false;
  private disposed = false;

  constructor(
    private readonly component: ServerComponent,
    readonly options: RenderOptions,
    private readonly tier: SessionTier,
  ) {
    this.applicationRuntime = createApplicationRuntime(`ssr-${++sessionSequence}`, {
      mode: tier.mode,
      document: tier.document,
      schedule: null,
      effects: 'disabled',
      refs: 'disabled',
    });
    this.routeRuntime = createRouteRuntime({
      routeHistory: createMemoryRouteHistory({
        initialEntries: [options.url ?? '/'],
      }),
    });
    this.dataRuntime = createDataRuntime(
      options.fetch === undefined ? {} : { fetch: options.fetch },
    );
    this.rootId = serverRootId(component);
    // Abort releases in-flight request data immediately rather than at the
    // asynchronous disposal that follows the rejected render.
    this.controller.signal.addEventListener('abort', () => this.dataRuntime.clear(), {
      once: true,
    });
    this.link(options.signal);
    this.link(options.routedContext?.request.signal);
    if (options.deadline !== undefined) {
      const timer = setTimeout(() => this.abort(new DOMException(
        `Server render exceeded its ${options.deadline}ms deadline`,
        'TimeoutError',
      )), options.deadline);
      this.unlinkSignals.push(() => clearTimeout(timer));
    }
  }

  /** The render-owned signal: aborted by any linked source or `abort()`. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(reason?: unknown): void {
    this.controller.abort(
      reason ?? new DOMException('Server render aborted', 'AbortError'),
    );
  }

  /** Run `fn` with this session's runtimes active, sync or async. */
  run<T>(fn: () => T): T {
    return runWithRouteRuntime(this.routeRuntime, () =>
      runWithDataRuntime(this.dataRuntime, () =>
        runWithApplicationRuntime(this.applicationRuntime, fn),
      ),
    );
  }

  /** Run matched route preparations; redirects surface as a typed error. */
  async prepare(): Promise<void> {
    this.signal.throwIfAborted();
    const outcome = await prepareInitialRoutedRuntime(this.routeRuntime, {
      ...(this.options.routedContext === undefined
        ? {}
        : { serverContext: this.options.routedContext }),
      signal: this.signal,
    });
    if (outcome.kind === 'redirect') {
      throw new RoutedPreparationRedirectError(outcome.redirect);
    }
  }

  mount(): Node {
    this.signal.throwIfAborted();
    return this.component(this.rootId, null);
  }

  /** In `resolve` mode, wait for request data within the settle budget. */
  async settle(): Promise<RenderSettlement> {
    if (this.options.mode !== 'resolve') return (this.settlement = SHELL);
    const started = performance.now();
    const settled = await this.untilAborted(
      this.dataRuntime.settle(this.options.timeout ?? DEFAULT_SETTLE_TIMEOUT),
    );
    this.signal.throwIfAborted();
    return (this.settlement = Object.freeze({
      status: settled ? 'complete' : 'timeout',
      settleMs: performance.now() - started,
    }));
  }

  /** The hydration payload: data state plus routed preparation state. */
  payload(): RenderPayload {
    const state = this.dataRuntime.serializeState();
    const routed = serializeRoutedPreparationState(this.routeRuntime);
    return {
      version: 1,
      ...(state.sources.length > 0 ? { state } : {}),
      ...(routed === undefined ? {} : { routed }),
    };
  }

  /** Wrap serialized application HTML in the hydration root marker pair. */
  wrap(html: string): string {
    return this.options.markers === true
      ? `<!--mmd:r:${this.rootId}-->${html}<!--/mmd-->`
      : html;
  }

  /** Hand the application runtime to the caller on success. */
  retain(): ApplicationRuntime {
    this.retained = this.tier.callerOwnsRuntime === true;
    return this.applicationRuntime;
  }

  /**
   * Release request-owned resources exactly once. Every step runs even if an
   * earlier one throws; the first failure is rethrown afterwards.
   */
  dispose(failed = false): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unlink of this.unlinkSignals.splice(0)) unlink();
    const errors: unknown[] = [];
    const attempt = (step: () => void): void => {
      try { step(); } catch (error) { errors.push(error); }
    };
    if (failed) {
      attempt(() => runWithApplicationRuntime(this.applicationRuntime, () =>
        unregisterSubtree(this.rootId)));
    }
    attempt(() => this.routeRuntime.dispose());
    attempt(() => this.dataRuntime.clear());
    if (failed || !this.retained) attempt(() => this.applicationRuntime.dispose());
    if (errors.length > 0) throw errors[0];
  }

  /**
   * Run a complete render: `body` executes inside the session scope. Failure
   * disposes everything; success disposes request runtimes and, for caller-
   * owned DOM renders, keeps the application runtime alive.
   */
  static execute<T>(
    component: ServerComponent,
    options: RenderOptions,
    tier: SessionTier,
    body: (session: RenderSession) => T,
  ): T {
    const session = new RenderSession(component, options, tier);
    let result: T;
    try {
      result = session.run(() => body(session));
    } catch (error) {
      session.disposeAfterFailure();
      throw error;
    }
    if (!isPromiseLike(result)) {
      session.dispose();
      return result;
    }
    return Promise.resolve(result).then(
      value => {
        session.dispose();
        return value;
      },
      (error: unknown) => {
        session.disposeAfterFailure();
        throw error;
      },
    ) as T;
  }

  private disposeAfterFailure(): void {
    try {
      this.dispose(true);
    } catch {
      // The render failure is the primary error; disposal errors after a
      // failed render must not mask it.
    }
  }

  private link(signal: AbortSignal | undefined): void {
    if (signal === undefined) return;
    if (signal.aborted) {
      this.controller.abort(abortReason(signal));
      return;
    }
    const forward = () => this.controller.abort(abortReason(signal));
    signal.addEventListener('abort', forward, { once: true });
    this.unlinkSignals.push(() => signal.removeEventListener('abort', forward));
  }

  private untilAborted<T>(operation: PromiseLike<T>): Promise<T> {
    const signal = this.signal;
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(operation).then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
