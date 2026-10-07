/**
 * @memoized-dom/server — production server rendering.
 *
 * Request isolation model:
 * - kernel state, cleanup, access tables, and prop boxes are isolated per
 *   call through a fresh ApplicationRuntime;
 * - compiled and runtime-owned DOM creation both route through that runtime's
 *   `RenderEnvironment.document`; rendering never swaps process globals, so
 *   concurrent request documents cannot contaminate one another;
 * - module-level authored state becomes request-safe with the Phase 1.3 cell
 *   lowering.
 *
 * Every renderer runs through one `RenderSession` (session.ts), which owns
 * the request runtimes, cancellation, settlement, and exactly-once disposal.
 * Output is produced by the string tier; the LinkeDOM correctness oracle
 * lives on the separate `@memoized-dom/server/dom` entry.
 *
 * Effects and refs do not run during server rendering.
 */

import { stringTier, type StringRenderableNode } from './string-document';
import { escapeJsonForScriptTag } from './json-script';
import type {
  RoutedServerContext,
  SerializedRoutedPreparationState,
} from '@memoized-dom/router/internal';
import type { SerializedDataState } from '@memoized-dom/data';
import { RenderSession, type RenderSettlement } from './session';
import type { ServerComponent } from './root-id';

export { serverRootId, type ServerComponent } from './root-id';
export type { RenderSettlement } from './session';

export interface RenderPayload {
  version: 1;
  state?: SerializedDataState;
  routed?: SerializedRoutedPreparationState;
}

export interface RenderResult {
  html: string;
  payload: RenderPayload;
  scriptTag: string;
  /** Whether request data settled completely or the settle budget elapsed. */
  settlement: RenderSettlement;
}

export interface RenderOptions {
  /** Host-selected matching compiler contract; omit for ordinary SSR/hydration. */
  initialKey?: string;
  /**
   * Settle mode (RFC §16.5):
   * - 'shell' (default): serialize immediately, emitting pending arms and
   *   bundling the state envelope.
   * - 'resolve': await in-flight data resources, flush entity updates, and
   *   serialize the fully resolved UI.
   * - 'stream': send the shell immediately, then each pending region as its
   *   data settles, in completion order. Needs `markers` and a streaming
   *   renderer; other renderers settle it like 'resolve'.
   */
  mode?: 'shell' | 'resolve' | 'stream';
  /** Soft settle budget in ms for 'resolve' and 'stream' modes (default 5000ms). */
  timeout?: number;
  /** CSP nonce for the inline scripts that patch streamed regions into place. */
  nonce?: string;
  /**
   * Hard budget in milliseconds for the whole render, route preparation
   * included. Unlike the soft `timeout` settle budget (which serializes
   * pending UI), exceeding it rejects the render with a `TimeoutError`.
   */
  deadline?: number;
  /** Abort the render and all request-owned preparation and data work. */
  signal?: AbortSignal;
  /**
   * Request URL. Installed as a request-local memory-history route runtime,
   * so compiled route regions and `route.*` reads resolve against this URL
   * during the render.
   */
  url?: string;
  /**
   * Fetch implementation backing the request-local data runtime (`$fetch`).
   * Defaults to globalThis.fetch; inject a deterministic
   * implementation for tests.
   */
  fetch?: typeof globalThis.fetch;
  /** Request-owned capabilities supplied by the full-stack application. */
  routedContext?: RoutedServerContext;
  /**
   * Serialize hydration markers (application root, conditional and list
   * regions, rows) into the output HTML. Client adoption matches against
   * these boundaries, so SSR for hydration requires `true`; `false` yields
   * clean HTML for hosts that never hydrate.
   */
  markers?: boolean;
}

export { escapeJsonForScriptTag };

export function createPayloadScriptTag(rootId: string, payload: RenderPayload): string {
  const safeJson = escapeJsonForScriptTag(JSON.stringify(payload));
  const safeRootId = rootId
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<script type="application/mmd+json" data-mmd-root="${safeRootId}">${safeJson}</script>`;
}

function serializeString(session: RenderSession, root: Node): string {
  return session.wrap(
    (root as unknown as StringRenderableNode).toString(session.markers, session.initialBindings),
  );
}

/**
 * Render a complete application: run route preparation, mount, settle
 * request data in `resolve` mode, and return the HTML together with its
 * hydration payload (`<script type="application/mmd+json">`).
 */
export async function render(
  component: ServerComponent,
  options: RenderOptions = {},
): Promise<RenderResult> {
  return RenderSession.execute(component, options, stringTier(), async session => {
    await session.prepare();
    const root = session.mount();
    await session.settle();
    const html = serializeString(session, root);
    const payload = session.payload();
    return {
      html,
      payload,
      scriptTag: session.carriesPayload ? createPayloadScriptTag(session.rootId, payload) : '',
      settlement: session.settlement,
    };
  });
}

/**
 * Synchronously render an application shell. No route preparation or data
 * settlement can run, so applications reading `$routed` values must use
 * `render()` or `renderToReadableStream()`.
 */
export function renderToString(
  component: ServerComponent,
  options: Omit<RenderOptions, 'mode' | 'timeout' | 'deadline' | 'signal'> = {},
): string {
  return RenderSession.execute(component, options, stringTier(), session => {
    if (session.initialDelivery && session.initialDelivery.html===undefined) {
      throw new Error('memo-dom: request-only HTML requires asynchronous rendering');
    }
    return serializeString(session, session.mount());
  });
}

export { renderToReadableStream } from './stream';
export { json, type JsonResponse } from './json';
export { error, type ErrorResponse } from './error';
export { getCookie, setCookie, deleteCookie, type CookieOptions } from './cookies';
export {
  composeDocumentStream,
  loadDocumentTemplate,
  splitDocumentTemplate,
  SSR_OUTLET,
  type DocumentTemplate,
} from './document';
export {
  serve,
  getServerContext,
  type RenderPolicy,
  type RenderReport,
  type ServeOptions,
  type ServerApplication,
  type ServerRouteContext,
  type ServerRouteHandler,
  type ServerRouteParams,
} from './serve';
export type {
  RegisteredServerLocals,
  RegisteredServerPlatform,
  RegisteredServerServices,
  ServerContext,
  ServerHandler,
  ServerHandlerResult,
  ServerMiddleware,
  ServerRoute,
  ServerTypeRegistry,
} from './http-router';
