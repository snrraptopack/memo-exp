/**
 * Internal application request handler.
 *
 * Combines normalized routes, middleware, page rendering, and the
 * same-origin in-memory `$fetch` bridge behind serve().
 */
import { createStorage, rootFactoryStore } from '@memoized-dom/runtime/server';
import { RoutedPreparationRedirectError } from '@memoized-dom/router/internal';
import {
  createServerRouter,
  type RegisteredServerLocals,
  type RegisteredServerPlatform,
  type RegisteredServerServices,
  type ServerContext,
  type ServerMiddleware,
  type ServerMiddlewareGroup,
  type ServerRoute,
  type ServerRouter,
} from './http-router';
import {
  composeDocumentStream,
  loadDocumentTemplate,
  splitDocumentTemplate,
  type DocumentTemplate,
} from './document';
import {
  render,
  type RenderOptions,
  type ServerComponent,
} from './index';
import type { RenderSettlement } from './session';
import { prepareRenderToReadableStream } from './stream';

/**
 * How one SSR root renders and is delivered. Application defaults merge
 * with per-`app.ssr()` overrides.
 */
export interface RenderPolicy {
  /** `resolve` (default) awaits request data; `shell` serializes pending UI. */
  readonly mode?: RenderOptions['mode'];
  /** Emit hydration markers and the payload (default `true`). */
  readonly markers?: boolean;
  /** Soft settle budget in ms; pending UI is serialized when it elapses. */
  readonly timeout?: number;
  /** Hard budget in ms for the whole render, route preparation included. */
  readonly deadline?: number;
  /**
   * `stream` (default) commits status and headers as soon as route
   * preparation has decided the response (authentication, redirects, routed
   * data), flushes the document head immediately, and streams the
   * application when it completes. `buffer` responds only with the complete
   * document, so any failure can still change the status.
   *
   * A streamed application body is atomic: markup and payload are emitted
   * together only after the render succeeds. If it fails after commit, the
   * document closes with an empty outlet and `mount()` performs a fresh client
   * render, so the page still works and no partial markup is ever adopted.
   */
  readonly delivery?: 'stream' | 'buffer';
}

export interface SsrTarget {
  readonly component: ServerComponent;
  readonly policy: RenderPolicy;
}

export interface RenderReport {
  readonly url: URL;
  readonly delivery: 'stream' | 'buffer';
  readonly outcome:
    | RenderSettlement['status']
    | 'redirect'
    | 'deadline'
    | 'aborted'
    | 'error';
  /** Time spent waiting for request data in `resolve` mode. */
  readonly settleMs?: number;
  /** Request-relative render duration, preparation through serialization. */
  readonly durationMs: number;
  /** Set when the render did not complete. */
  readonly error?: unknown;
}

export interface ApplicationHandlerOptions<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly resolveApp?: (
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => SsrTarget | undefined;
  readonly document?: string | URL;
  readonly documentTemplate?: string;
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
  readonly routes?: readonly ServerRoute<TLocals, TPlatform, TServices>[];
  readonly groups?: readonly ServerMiddlewareGroup<TLocals, TPlatform, TServices>[];
  readonly render?: RenderPolicy;
  readonly onRender?: (
    report: RenderReport,
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => void;
  readonly init?: ResponseInit;
  readonly createLocals?: (request: Request) => TLocals;
  readonly createPlatform?: (request: Request) => TPlatform | undefined;
  readonly services: TServices;
  readonly fetch?: typeof globalThis.fetch;
  readonly onError?: (
    error: unknown,
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => Response | Promise<Response>;
}

export type ApplicationHandler = (request: Request) => Promise<Response>;

interface ActiveServerContext {
  readonly context: ServerContext<object, unknown, object>;
  readonly dispatchDepth: number;
}

const activeServerContext = createStorage<ActiveServerContext>(
  'memoized-dom:server-context',
);
const MAX_DISPATCH_DEPTH = 8;
const DEFAULT_TIMEOUT = 10_000;

/** Read the request context from middleware or a server-function body. */
export function getServerContext<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(): ServerContext<TLocals, TPlatform, TServices> {
  const active = activeServerContext.getStore();
  if (active === undefined) {
    throw new Error(
      'memo-dom: getServerContext() must be called while serve() is handling a request',
    );
  }
  return active.context as unknown as ServerContext<TLocals, TPlatform, TServices>;
}

function prepareDocument<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
): DocumentTemplate | undefined {
  if (options.document !== undefined && options.documentTemplate !== undefined) {
    throw new TypeError(
      'memo-dom: application handler accepts either a document or documentTemplate, not both',
    );
  }
  const template = options.documentTemplate !== undefined
    ? splitDocumentTemplate(options.documentTemplate)
    : options.document !== undefined
      ? loadDocumentTemplate(options.document)
      : undefined;
  if (
    options.resolveApp !== undefined &&
    template === undefined
  ) {
    throw new TypeError(
      'memo-dom: SSR requires a document template',
    );
  }
  return template;
}

function serverContextMiddleware<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(): ServerMiddleware<TLocals, TPlatform, TServices> {
  return (context, next) => {
    const inheritedDepth = activeServerContext.getStore()?.dispatchDepth ?? 0;
    return activeServerContext.run(
      {
        context: context as unknown as ServerContext<object, unknown, object>,
        dispatchDepth: inheritedDepth,
      },
      next,
    );
  };
}

function createServerFetch<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  router: ServerRouter<TLocals, TPlatform, TServices>,
  parent: ServerContext<TLocals, TPlatform, TServices>,
  hostFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return ((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      parent.url,
    );
    const signals = [
      parent.request.signal,
      input instanceof Request ? input.signal : undefined,
      init?.signal ?? undefined,
    ].filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length < 2
      ? signals[0]
      : AbortSignal.any(signals);
    const requestInit: RequestInit = {
      ...init,
      ...(signal === undefined ? {} : { signal }),
    };
    const request = input instanceof Request
      ? new Request(input, requestInit)
      : new Request(url, requestInit);
    const sameOriginRoute = url.origin === parent.url.origin &&
      (router.matches(url.pathname, request.method) ||
        router.allowedMethods(url.pathname).length > 0);
    if (!sameOriginRoute) return hostFetch(request);
    const current = activeServerContext.getStore();
    const dispatchDepth = (current?.dispatchDepth ?? 0) + 1;
    if (dispatchDepth > MAX_DISPATCH_DEPTH) {
      return Promise.reject(new Error(
        'memo-dom: in-memory $fetch dispatch exceeded the maximum depth; a route handler appears to fetch itself',
      ));
    }
    return activeServerContext.run(
      {
        context: (current?.context ?? parent) as unknown as ServerContext<
          object,
          unknown,
          object
        >,
        dispatchDepth,
      },
      () => router.dispatch(request, {
        locals: parent.locals,
        ...(parent.platform === undefined ? {} : { platform: parent.platform }),
        services: parent.services,
      }),
    );
  }) as typeof globalThis.fetch;
}

function htmlResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }
  return new Response(body, { ...init, headers });
}

function failureOutcome(error: unknown, request: Request): RenderReport['outcome'] {
  if (error instanceof RoutedPreparationRedirectError) return 'redirect';
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError') return 'deadline';
  return request.signal.aborted || name === 'AbortError' ? 'aborted' : 'error';
}

async function renderPage<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  context: ServerContext<TLocals, TPlatform, TServices>,
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
  router: ServerRouter<TLocals, TPlatform, TServices>,
  template: DocumentTemplate | undefined,
): Promise<Response> {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  const target = options.resolveApp?.(context);
  if (target === undefined || template === undefined) {
    return new Response('Not Found', { status: 404 });
  }

  const policy: RenderPolicy = { ...options.render, ...target.policy };
  const delivery = policy.delivery ?? 'stream';
  const markers = policy.markers ?? true;
  const contract = rootFactoryStore().get(target.component)?.initialDelivery;
  const initial = template.initial;
  const renderOptions: RenderOptions = {
    mode: policy.mode ?? 'resolve',
    markers,
    ...(initial === undefined ? {} : { initialKey: initial.key }),
    timeout: policy.timeout ?? DEFAULT_TIMEOUT,
    ...(policy.deadline === undefined ? {} : { deadline: policy.deadline }),
    url: context.url.pathname + context.url.search,
    fetch: createServerFetch(router, context, options.fetch ?? globalThis.fetch),
    routedContext: context,
  };
  const started = performance.now();
  const report = (
    outcome: RenderReport['outcome'],
    detail: { settleMs?: number; error?: unknown } = {},
  ): void => {
    options.onRender?.({
      url: context.url,
      delivery,
      outcome,
      durationMs: performance.now() - started,
      ...detail,
    }, context);
  };
  const settled = (settlement: RenderSettlement): void => {
    report(settlement.status, settlement.status === 'shell'
      ? {}
      : { settleMs: settlement.settleMs });
  };

  try {
    if (initial && (initial.key !== contract?.key || initial.target !== contract.target || initial.browser !== contract.browser)) {
      throw new Error('memo-dom: page template and server root compiler delivery contracts do not match');
    }
    if (delivery === 'buffer') {
      const result = await render(target.component, renderOptions);
      settled(result.settlement);
      const headers = new Headers(options.init?.headers);
      headers.append('server-timing', serverTiming(result.settlement, performance.now() - started));
      return htmlResponse(
        template.prefix +
          (markers ? result.html + result.scriptTag : result.html) +
          template.suffix,
        { ...options.init, headers },
      );
    }

    const application = prepareRenderToReadableStream(target.component, renderOptions);
    // Commit only once preparation has decided the response: redirects and
    // gate failures still produce their own status through the error path.
    await application.prepared;
    application.ready.then(settled, (error: unknown) => {
      report(failureOutcome(error, context.request), { error });
    });
    return htmlResponse(
      composeDocumentStream({
        prefix: template.prefix,
        body: application.stream,
        suffix: template.suffix,
        // Post-commit failure: leave the outlet empty so the client mounts
        // fresh; the failure is reported through `onRender`.
        onBodyError: () => undefined,
      }),
      options.init,
    );
  } catch (error) {
    report(failureOutcome(error, context.request), { error });
    if (!(error instanceof RoutedPreparationRedirectError)) throw error;
    return Response.redirect(
      new URL(error.redirect.to, context.url),
      302,
    );
  }
}

function serverTiming(settlement: RenderSettlement, durationMs: number): string {
  const total = `ssr;dur=${durationMs.toFixed(1)};desc="${settlement.status}"`;
  return settlement.status === 'shell'
    ? total
    : `${total}, ssr-settle;dur=${settlement.settleMs.toFixed(1)}`;
}

/** Build the Web handler from serve()'s normalized application declarations. */
export function createApplicationHandler<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
): ApplicationHandler {
  const template = prepareDocument(options);
  let router: ServerRouter<TLocals, TPlatform, TServices>;
  router = createServerRouter({
    routes: options.routes ?? [],
    groups: options.groups,
    middleware: [serverContextMiddleware(), ...(options.middleware ?? [])],
    createLocals: options.createLocals,
    createPlatform: options.createPlatform,
    services: options.services,
    onError: options.onError,
    fallback: context => renderPage(context, options, router, template),
  });
  return request => router.fetch(request);
}
