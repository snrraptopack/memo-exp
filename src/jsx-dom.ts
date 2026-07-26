/**
 * jsx-dom.ts - DOM structure helpers required by compiled JSX.
 *
 * DocumentFragment nodes disappear into their parent when inserted. Keyed
 * reconciliation snapshots their children beforehand so removal and movement
 * retain the same multi-node ownership semantics as a single element root.
 */

export function rootNodes(root: Node): Node[] {
  return root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
    ? Array.from(root.childNodes)
    : [root];
}
