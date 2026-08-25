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
 * Effects and refs do not run during server rendering.
 */

import { parseHTML } from 'linkedom';
import {
  createApplicationRuntime,
  runWithApplicationRuntime,
  setActiveApplicationRuntime,
  unregisterSubtree,
  type ApplicationRuntime,
  type DocumentLike,
} from '@memoized-dom/runtime';
import {
  createMemoryRouteHistory,
  createRouteRuntime,
  setActiveRouteRuntime,
} from '@memoized-dom/router';
import {
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';

/** A compiled application root factory: `function App(_id, _parent)`. */
export type ServerComponent = (id: string, parent: null) => Node;

export interface RenderOptions {
  /**
   * Request URL. Installed as a request-local memory-history route runtime,
   * so compiled route regions and `route.*` reads resolve against this URL
   * during the synchronous render.
   */
  url?: string;
  /**
   * Fetch implementation backing the request-local data runtime (`$fetch`/
   * `$action`). Defaults to globalThis.fetch; inject a deterministic
   * implementation for tests.
   */
  fetch?: typeof globalThis.fetch;
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
}

let renderSequence = 0;

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
function serialize(
  nodes: readonly Node[],
  markers: boolean,
  rootId: string,
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
      return markers ? html : stripComments(html);
    }
    return node.textContent ?? '';
  };

  let html = '';
  for (const node of nodes) html += serializeNode(node);
  // Hydration protocol (hydration-markers.md §2): the application-root pair
  // wraps every root node so adoption locates the application boundary.
  if (markers) {
    html = `<!--mmd:r:${rootId}-->${html}<!--/mmd-->`;
  }
  return html;
}

/** Remove top-level and nested comments from serialized element HTML. */
function stripComments(html: string): string {
  if (!html.includes('<!--')) return html;
  return html.replace(/<!--[\s\S]*?-->/g, '');
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
      if (value === true && !element.hasAttribute(attribute)) {
        element.setAttribute(attribute, '');
      }
      // A false property with an absent attribute already encodes false.
    }
  }
}

/**
 * Render a compiled application into a server document and return the live
 * handles. The caller owns `runtime.dispose()`. Per-request router/data
 * runtimes are restored and disposed here regardless of outcome.
 */
export function renderWithDom(
  component: ServerComponent,
  options: RenderOptions = {},
): RenderedDom {
  const { document: serverDocument } = parseServerDocument(options.document);

  const runtime = createApplicationRuntime(`ssr-${++renderSequence}`, {
    mode: 'server-dom',
    document: serverDocument,
    schedule: null,
    effects: 'disabled',
    refs: 'disabled',
  });
  const previousRuntime = setActiveApplicationRuntime(runtime);

  // Request-local router and data runtimes: compiled modules read `route`
  // and `$fetch` through ambient-active facades, so activating these makes
  // the render resolve against this request's URL and fetch without authors
  // changing their imports. Restored and disposed in finally.
  const routeHistory = createMemoryRouteHistory({
    initialEntries: [options.url ?? '/'],
  });
  const routeRuntime = createRouteRuntime({ routeHistory });
  const dataRuntime = createDataRuntime(
    options.fetch === undefined ? {} : { fetch: options.fetch },
  );
  const previousRouteRuntime = setActiveRouteRuntime(routeRuntime);
  const previousDataRuntime = setActiveDataRuntime(dataRuntime);


  const rootId = 'App';
  try {
    const root = runWithApplicationRuntime(runtime, () =>
      component(rootId, null),
    );
    const nodes =
      root?.nodeType === 11 /* FRAGMENT */
        ? Array.from(root.childNodes)
        : [root as Node];
    for (const node of nodes) syncBooleanAttributes(node);
    return {
      document: serverDocument as unknown as Document,
      html: serialize(nodes, options.markers === true, rootId),
      nodes,
      runtime,
    };
  } catch (error) {
    runWithApplicationRuntime(runtime, () => {
      unregisterSubtree(rootId);
    });
    throw error;
  } finally {
    setActiveApplicationRuntime(previousRuntime);
    setActiveRouteRuntime(previousRouteRuntime);
    setActiveDataRuntime(previousDataRuntime);
    routeRuntime.dispose();
    dataRuntime.clear();
  }
}


/**
 * Render a compiled application to an HTML string. The request runtime and
 * server document are always disposed, including on failure.
 */
export function renderToString(
  component: ServerComponent,
  options: RenderOptions = {},
): string {
  let rendered: RenderedDom | undefined;
  try {
    rendered = renderWithDom(component, options);
    return rendered.html;
  } finally {
    rendered?.runtime.dispose();
  }
}
