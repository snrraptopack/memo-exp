/**
 * jsx-dom.ts - DOM structure helpers required by compiled JSX.
 *
 * DocumentFragment nodes disappear into their parent when inserted. Keyed
 * reconciliation snapshots their children beforehand so removal and movement
 * retain the same multi-node ownership semantics as a single element root.
 */

export function rootNodes(root: Node): Node[] {
  // Literal node-type constant: compiled code runs in bare Node (SSR) where
  // the ambient `Node` class does not exist.
  return root.nodeType === 11 /* DOCUMENT_FRAGMENT */
    ? Array.from(root.childNodes)
    : [root];
}
