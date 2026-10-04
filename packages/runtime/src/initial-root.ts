/** Adopt a compiler-proven static root and insert its live component nodes. */
import { getActiveEnvironment } from './kernel';

export function adoptInitialRoot(target: string, placements: readonly (readonly [number, Node])[]): DocumentFragment {
  const document = getActiveEnvironment().document;
  const host = document.getElementById(target);
  if (!host) throw new Error(`memo-dom: initial HTML target '${target}' was not found`);
  const markers = new Map<number, Comment>();
  const pending: Node[] = Array.from(host.childNodes);
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeType === 8) {
      const match = /^mmd:initial:(\d+)$/.exec((node as Comment).data);
      if (match) {
        const id = Number(match[1]);
        if (markers.has(id)) throw new Error('memo-dom: duplicate initial HTML placement');
        markers.set(id, node as Comment);
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) pending.push(child);
  }
  // Validate every placement before modifying the retained HTML.
  if (markers.size !== placements.length || new Set(placements.map(([id]) => id)).size !== placements.length ||
      placements.some(([id]) => !markers.has(id))) throw new Error('memo-dom: initial HTML placements do not match the browser program');
  for (const [id, node] of placements) {
    const marker = markers.get(id)!;
    marker.parentNode!.replaceChild(node, marker);
  }
  const root = document.createDocumentFragment();
  while (host.firstChild) root.appendChild(host.firstChild);
  return root;
}
