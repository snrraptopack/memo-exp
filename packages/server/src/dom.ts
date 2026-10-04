/**
 * @memoized-dom/server/dom — LinkeDOM reference renderer.
 *
 * Renders through a real DOM implementation as the correctness oracle for
 * the production string tier. Kept on its own entry so production servers
 * never load LinkeDOM.
 */

import { parseHTML } from 'linkedom';
import type { ApplicationRuntime, DocumentLike } from '@memoized-dom/runtime/server';
import type { RenderOptions } from './index';
import type { ServerComponent } from './root-id';
import { RenderSession, type RenderSettlement } from './session';

export interface DomRenderOptions extends RenderOptions {
  /** Inject a document instead of LinkeDOM (tests, alternative DOM tiers). */
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

/**
 * Serialize adopted render output.
 *
 * `markers: true` preserves every comment, including bare top-level
 * comments, which element `outerHTML` cannot cover. Comment bodies are
 * compiler-generated identities and validated so they can never terminate
 * the comment early.
 *
 * `markers: false` strips all comments — including nested ones that
 * element `outerHTML` would otherwise carry — for clean host-consumable
 * HTML.
 */
function serialize(nodes: readonly Node[], markers: boolean): string {
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
    for (const child of Array.from(parent.childNodes)) {
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

/**
 * Render a compiled application into a server document and return the live
 * handles. The caller owns `runtime.dispose()`; per-request router and data
 * runtimes are released here regardless of outcome.
 */
export function renderWithDom(
  component: ServerComponent,
  options: DomRenderOptions = {},
): RenderedDom {
  const document = options.document ??
    parseHTML('<!doctype html><html><head></head><body></body></html>')
      .document as unknown as DocumentLike;
  return RenderSession.execute(
    component,
    options,
    { mode: 'server-dom', document, callerOwnsRuntime: true },
    session => {
      const root = session.mount();
      const nodes = root?.nodeType === 11 /* FRAGMENT */
        ? Array.from(root.childNodes)
        : [root];
      for (const node of nodes) syncBooleanAttributes(node);
      return {
        document: document as unknown as Document,
        html: session.wrap(serialize(nodes, options.markers === true)),
        nodes,
        runtime: session.retain(),
        settlement: session.settlement,
      };
    },
  );
}
