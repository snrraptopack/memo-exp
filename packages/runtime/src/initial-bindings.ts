/** Bind only the DOM nodes required by a compiler-proven initial program. */
import { getActiveEnvironment } from './kernel';

export function bindInitialNodes(
  target: string,
  bindings: readonly (readonly [readonly number[], string])[],
): Node[] {
  const document = getActiveEnvironment().document;
  const host = document.getElementById(target);
  if (!host) throw new Error(`memo-dom: initial HTML target '${target}' was not found`);
  const nodes = bindings.map(([path, kind]) => {
    let node: Node = host;
    for (const index of path) {
      const child = node.childNodes[index];
      if (!Number.isInteger(index) || index < 0 || !child) {
        throw new Error('memo-dom: initial DOM binding path is missing');
      }
      node = child;
    }
    const matches = kind.startsWith('#comment:')
      ? node.nodeType === 8 && (node as Comment).data === kind.slice(9)
      : kind === '#text'
      ? node.nodeType === 3 || node.nodeType === 8 && (node as Comment).data === 'mmd:empty'
      : node.nodeType === 1 && (node as Element).localName === kind &&
        (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml';
    if (!matches) {
      throw new Error('memo-dom: initial DOM binding shape does not match the browser program');
    }
    return node;
  });
  // Complete validation before replacing empty text markers or binding events.
  const replacements = new Map<Node, Text>();
  return nodes.map(node => {
    if (node.nodeType !== 8 || (node as Comment).data !== 'mmd:empty') return node;
    let text = replacements.get(node);
    if (!text) {
      text = document.createTextNode('');
      node.parentNode!.replaceChild(text, node);
      replacements.set(node, text);
    }
    return text;
  });
}
