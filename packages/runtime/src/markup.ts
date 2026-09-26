/**
 * markup.ts - "DOM as data" materialization for compiler-generated static
 * subtrees.
 *
 * The compiler serializes each eligible static subtree into a module-level
 * markup string and emits one materializeMarkup(markup) call per segment.
 * The call returns every markup'd node in compiler creation order
 * (post-order: descendants before parents — the markup root is last), which
 * is the same sequence imperative creation emitted and the same sequence
 * hydration plans expect.
 *
 * Modes:
 *   client-create — parse once into a cached <template>, cloneNode(true)
 *                   per instance; far cheaper than per-node createElement.
 *   hydrate       — HydrationController.claimMarkup claims each node
 *                   through the active creation plan (marker-aware,
 *                   fully validated, no real DOM construction).
 *   server modes  — the injected DocumentLike supplies materializeMarkup
 *                   (StringDocument interprets markup through its own
 *                   factories, keeping SSR output byte-identical). The
 *                   markup parser stays out of browser bundles.
 */

import { getActiveEnvironment } from './kernel';

const templates = new Map<string, Element>();

/**
 * Materialize one compiler-generated markup string. Returns nodes in
 * compiler creation order (post-order DFS — the markup root is last).
 */
export function materializeMarkup(markup: string): Node[] {
  const environment = getActiveEnvironment();
  const hydration = environment.hydration;
  if (hydration !== undefined) {
    return hydration.claimMarkup(markup);
  }
  const document = environment.document;
  if (document.materializeMarkup !== undefined) {
    return document.materializeMarkup(markup);
  }
  let template = templates.get(markup);
  if (template === undefined) {
    template = document.createElement('template');
    (template as { innerHTML: string }).innerHTML = markup;
    templates.set(markup, template);
  }
  const clone = (
    template as unknown as { content: DocumentFragment }
  ).content.cloneNode(true);
  const nodes: Node[] = [];
  collectCreationOrder((clone as DocumentFragment).firstChild, null, nodes);
  return nodes;
}

/**
 * Post-order walk matching the compiler's creation order and the hydration
 * plan's collectCreationOrder for markup subtrees (markup contains no
 * structural markers — structural ranges stay imperative).
 */
function collectCreationOrder(
  start: Node | null,
  end: Node | null,
  output: Node[],
): void {
  let node = start;
  while (node !== null && node !== end) {
    collectCreationOrder(node.firstChild, null, output);
    output.push(node);
    node = node.nextSibling;
  }
}
