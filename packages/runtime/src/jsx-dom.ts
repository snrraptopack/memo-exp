/**
 * jsx-dom.ts - DOM structure helpers required by compiled JSX.
 *
 * DocumentFragment nodes disappear into their parent when inserted. Keyed
 * reconciliation snapshots their children beforehand so removal and movement
 * retain the same multi-node ownership semantics as a single element root.
 */

interface AdoptedFragmentHolder {
  __mmdAdoptedChildren?: readonly Node[];
}

export function rootNodes(root: Node): Node[] {
  if (root.nodeType !== 11 /* DOCUMENT_FRAGMENT */) return [root];
  if (
    typeof root === 'object' &&
    root !== null &&
    '__mmdAdoptedChildren' in root
  ) {
    const holder = root as AdoptedFragmentHolder;
    if (holder.__mmdAdoptedChildren !== undefined) {
      return [...holder.__mmdAdoptedChildren];
    }
  }
  return Array.from(root.childNodes);
}
