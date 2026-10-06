/** Optional markup claims use the same node plan and element adoption methods. */
import { walkMarkup } from './markup-walk';
import type { HydrationDocument } from './hydration';

export function hydrateMarkup(document: HydrationDocument, markup: string): Node[] {
  const nodes: Node[] = [];
  walkMarkup(markup, (tag, namespaceURI) => {
    nodes.push(tag === null ? document.createTextNode('') : document.createElementNS(namespaceURI, tag));
  });
  return nodes;
}
