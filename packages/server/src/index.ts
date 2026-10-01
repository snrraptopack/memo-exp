/**
 * @memoized-dom/server - LinkeDOM reference renderer (SSR Phase 1.4).
 *
 * Renders compiled applications to HTML through a real DOM implementation,
 * serving as the correctness oracle for the future string-writer tier.
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
 *
 * Effects and refs do not run during server rendering.
 */

import { parseHTML } from 'linkedom';
import type { ApplicationRuntime, DocumentLike } from '@memoized-dom/runtime/server';
import { StringDocument, type StringRenderableNode } from './string-document';
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
  /**
   * Settle mode (RFC §16.5):
   * - 'shell' (default synchronous): render immediately emitting pending arms
   *   and bundling the state envelope.
   * - 'resolve': await in-flight data resources, flush entity updates, and
   *   serialize the fully resolved UI.
   */
  mode?: 'shell' | 'resolve';
  /** Maximum settle time in ms for 'resolve' mode (default 5000ms). */
  timeout?: number;
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
   * Serialize runtime structural anchors (conditional `when:`, list `list:`,
   * and future hydration markers) into the output HTML. These comment
   * boundaries are what the client adoption cursor matches against, so SSR
   * for hydration requires `true`.
   *
   * When `false` (default until client adoption ships), all comments are
   * stripped and the output is clean host-consumable HTML.
   */
  markers?: boolean;
  /**
   * Inject a document instead of LinkeDOM (tests, alternative DOM tiers).
   */
  document?: DocumentLike;
}

export interface RenderedDom {
  /** The server document that produced the output. */
  readonly document: Document;
  readonly html: string;
  readonly nodes: readonly Node[];
  /** Caller-owned: dispose after inspecting nodes/HTML. */
  readonly runtime: ApplicationRuntime;
  /** Whether request data settled completely or the settle budget elapsed. */
  readonly settlement: RenderSettlement;
}

function parseServerDocument(
  injected?: DocumentLike,
): { document: Document } {
  if (injected !== undefined) {
    // An injected DocumentLike doubles as the host document.
    return { document: injected as unknown as Document };
  }
  const parsed = parseHTML(
    '<!doctype html><html><head></head><body></body></html>',
  );
  return { document: parsed.document };
}

/**
 * Serialize adopted render output.
 *
 * `markers: true` preserves every comment — runtime region anchors now and
 * hydration markers once Phase 2 emission lands — including bare top-level
 * comments, which element `outerHTML` cannot cover. Comment bodies are
 * compiler-generated identities and validated so they can never terminate
 * the comment early.
 *
 * `markers: false` strips all comments — including nested ones that
 * element `outerHTML` would otherwise carry — for clean host-consumable
 * HTML.
 */
/**
 * Safely serializes a JSON state payload for HTML script-tag embedding.
 * Escapes `<`, `>`, and `&` using Unicode escapes (`\u003c`, `\u003e`, `\u0026`)
 * to prevent premature script block closure or XSS injection (RFC §16.6).
 */
export function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function createPayloadScriptTag(rootId: string, payload: RenderPayload): string {
  const safeJson = escapeJsonForScriptTag(JSON.stringify(payload));
  const safeRootId = rootId
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<script type="application/mmd+json" data-mmd-root="${safeRootId}">${safeJson}</script>`;
}

function serialize(
  nodes: readonly Node[],
  markers: boolean,
): string {
  const serializeNode = (node: Node): string => {
    if (node.nodeType === 8 /* COMMENT */) {
      if (!markers) return '';
      const body = (node as Comment).data;
      if (body.includes('-->') || body.endsWith('-')) {
        // Defensive: compiler identities cannot produce these today. Strip
        // rather than emit a corruptable comment.
        return '';
      }
      return `<!--${body}-->`;
    }
    if (node.nodeType === 11 /* FRAGMENT */) {
      let fragment = '';
      for (const child of node.childNodes) fragment += serializeNode(child);
      return fragment;
    }
    const html = (node as Element).outerHTML;
    if (html !== undefined) {
      return markers ? html : stripComments(node);
    }
    return node.textContent ?? '';
  };


  let html = '';
  for (const node of nodes) html += serializeNode(node);
  return html;
}

function stripComments(node: Node): string {
  const clone = node.cloneNode(true);
  const visit = (parent: Node): void => {
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === 8) {
        parent.removeChild(child);
      } else if (child.nodeType === 1 || child.nodeType === 11) {
        visit(child);
      }
    }
  };
  visit(clone);
  return (clone as Element).outerHTML ?? clone.textContent ?? '';
}

/**
 * Property-backed attributes set during creation (compiled `checked`,
 * `disabled`, ... lower to property writes) do not serialize in every DOM
 * implementation. Sync the known boolean set back to attributes before
 * serialization so server HTML is semantically complete.
 */
const BOOLEAN_PROPS: ReadonlyArray<readonly [string, string]> = [
  ['checked', 'checked'],
  ['disabled', 'disabled'],
  ['selected', 'selected'],
  ['readOnly', 'readonly'],
  ['multiple', 'multiple'],
  ['required', 'required'],
  ['open', 'open'],
  ['hidden', 'hidden'],
  ['muted', 'muted'],
];

export function syncBooleanAttributes(root: Node): void {
  const ownerDocument = root.ownerDocument;
  if (ownerDocument === null) return;
  const walker = ownerDocument.createTreeWalker(root, 1 /* ELEMENT */);
  for (
    let element = walker.nextNode() as Element | null;
    element !== null;
    element = walker.nextNode() as Element | null
  ) {
    for (const [prop, attribute] of BOOLEAN_PROPS) {
      const value = (element as unknown as Record<string, unknown>)[prop];
      if (value === true) {
        if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
      } else if (value === false) {
        element.removeAttribute(attribute);
      }
    }
  }
}

function domTier(options: RenderOptions) {
  return {
    mode: 'server-dom',
    document: parseServerDocument(options.document).document as unknown as DocumentLike,
    callerOwnsRuntime: true,
  } as const;
}

function stringTier() {
  return { mode: 'server-string', document: new StringDocument() } as const;
}

function completeDom(
  session: RenderSession,
  document: DocumentLike,
  root: Node,
): RenderedDom {
  const nodes =
    root?.nodeType === 11 /* FRAGMENT */
      ? Array.from(root.childNodes)
      : [root];
  for (const node of nodes) syncBooleanAttributes(node);
  return {
    document: document as unknown as Document,
    html: session.wrap(serialize(nodes, session.options.markers === true)),
    nodes,
    runtime: session.retain(),
    settlement: session.settlement,
  };
}

function serializeString(session: RenderSession, root: Node): string {
  return session.wrap(
    (root as unknown as StringRenderableNode).toString(session.options.markers === true),
  );
}

function stringResult(session: RenderSession, root: Node): RenderResult {
  const html = serializeString(session, root);
  const payload = session.payload();
  return {
    html,
    payload,
    scriptTag: createPayloadScriptTag(session.rootId, payload),
    settlement: session.settlement,
  };
}

/**
 * Render a compiled application into a server document and return the live
 * handles. The caller owns `runtime.dispose()`. Per-request router/data
 * runtimes are restored and disposed here regardless of outcome.
 */
export function renderWithDomAsync(
  component: ServerComponent,
  options: RenderOptions = {},
): Promise<RenderedDom> {
  const tier = domTier(options);
  return RenderSession.execute(component, options, tier, async session => {
    await session.prepare();
    const root = session.mount();
    await session.settle();
    return completeDom(session, tier.document, root);
  });
}

export function renderWithDom(
  component: ServerComponent,
  options: RenderOptions = {},
): RenderedDom {
  const tier = domTier(options);
  return RenderSession.execute(component, options, tier, session =>
    completeDom(session, tier.document, session.mount()));
}

/**
 * Render a compiled application to an HTML string using the fast StringDocument tier.
 */
export function renderToString(
  component: ServerComponent,
  options: RenderOptions = {},
): string {
  return RenderSession.execute(component, options, stringTier(), session =>
    serializeString(session, session.mount()));
}

/**
 * Render a compiled application to an HTML string asynchronously, settling
 * in-flight data resources before serialization when mode is 'resolve' (RFC §16.5).
 */
export function renderToStringAsync(
  component: ServerComponent,
  options: RenderOptions = {},
): Promise<string> {
  return RenderSession.execute(component, options, stringTier(), async session => {
    await session.prepare();
    const root = session.mount();
    await session.settle();
    return serializeString(session, root);
  });
}

/**
 * Render a compiled application to an HTML string and its companion DOM-embedded
 * JSON state payload channel (`<script type="application/mmd+json">`).
 */
export function renderToResult(
  component: ServerComponent,
  options: RenderOptions = {},
): RenderResult {
  return RenderSession.execute(component, options, stringTier(), session =>
    stringResult(session, session.mount()));
}

export function renderToResultAsync(
  component: ServerComponent,
  options: RenderOptions = {},
): Promise<RenderResult> {
  return RenderSession.execute(component, options, stringTier(), async session => {
    await session.prepare();
    const root = session.mount();
    await session.settle();
    return stringResult(session, root);
  });
}

export { renderToReadableStream } from './stream';
export { json, type JsonResponse } from './json';
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
