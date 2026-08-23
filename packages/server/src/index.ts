/**
 * @memoized-dom/server - LinkeDOM reference renderer (SSR Phase 1.4).
 *
 * Renders compiled applications to HTML through a real DOM implementation,
 * serving as the correctness oracle for the future string-writer tier.
 *
 * Request isolation model (current tier):
 * - kernel state, cleanup, access tables, and prop boxes are isolated per
 *   call through a fresh ApplicationRuntime;
 * - the ambient `document` global is swapped to the server document for the
 *   duration of the synchronous render, because compiled element creation
 *   references the global directly. Rendering is synchronous, so this is
 *   safe until deferred/streaming work exists; module-level authored state
 *   becomes request-safe with the Phase 1.3 cell lowering.
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

/** A compiled application root factory: `function App(_id, _parent)`. */
export type ServerComponent = (id: string, parent: null) => Node;

export interface RenderOptions {
  /**
   * Request URL. Reserved for request-local router installation once the
   * router gains a server wiring seam; accepted now so call sites are
   * forward-compatible.
   */
  url?: string;
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

function serialize(nodes: readonly Node[]): string {
  let html = '';
  for (const node of nodes) {
    // Runtime region anchors (when:/list: comments) are declared-irrelevant
    // serializer details; a bare comment node has no outerHTML and must not
    // fall through to raw textContent serialization.
    if (node.nodeType === 8 /* COMMENT */) continue;
    if (node.nodeType === 11 /* FRAGMENT */) {
      for (const child of node.childNodes) {
        if (child.nodeType === 8 /* COMMENT */) continue;
        html += (child as Element).outerHTML ?? child.textContent ?? '';
      }
      continue;
    }
    html += (node as Element).outerHTML ?? node.textContent ?? '';
  }
  return html;
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
  const walker = document.createTreeWalker(root, 1 /* ELEMENT */);
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
 * handles. The caller owns `runtime.dispose()` and global restoration is
 * always performed before return.
 */
export function renderWithDom(
  component: ServerComponent,
  options: RenderOptions = {},
): RenderedDom {
  const previousDocument = globalThis.document;
  const previousFrameScheduler = globalThis.requestAnimationFrame;
  const { document: serverDocument } = parseServerDocument(options.document);

  const runtime = createApplicationRuntime(`ssr-${++renderSequence}`, {
    mode: 'server-dom',
    document: serverDocument,
    schedule: null,
    effects: 'disabled',
    refs: 'disabled',
  });
  const previousRuntime = setActiveApplicationRuntime(runtime);

  // Compiled element creation references the ambient global; structural
  // runtime code routes through environment.document. Both must agree.
  globalThis.document = parsed_document(serverDocument);

  // Server rendering never schedules volatile pulls.
  delete (globalThis as { requestAnimationFrame?: unknown })
    .requestAnimationFrame;

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
      html: serialize(nodes),
      nodes,
      runtime,
    };
  } catch (error) {
    runWithApplicationRuntime(runtime, () => {
      unregisterSubtree(rootId);
    });
    throw error;
  } finally {
    restoreGlobals(previousDocument, previousFrameScheduler);
    setActiveApplicationRuntime(previousRuntime);
  }
}

function parsed_document(document: DocumentLike): Document {
  return document as unknown as Document;
}

function restoreGlobals(
  previousDocument: typeof globalThis.document,
  previousFrameScheduler: typeof globalThis.requestAnimationFrame,
): void {
  if (previousDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    globalThis.document = previousDocument;
  }
  if (previousFrameScheduler === undefined) {
    delete (globalThis as { requestAnimationFrame?: unknown })
      .requestAnimationFrame;
  } else {
    globalThis.requestAnimationFrame = previousFrameScheduler;
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
