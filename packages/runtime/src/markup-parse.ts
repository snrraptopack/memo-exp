/** Server value materialization over the shared compiler-markup traversal. */
import { walkMarkup } from './markup-walk';
export { HTML_NS, SVG_NS, MATH_NS } from './markup-walk';

export interface MarkupElement {
  type: 'element';
  tag: string;
  ns: string;
  attrs: [string, string][];
  children: MarkupChild[];
}

export interface MarkupText {
  type: 'text';
  text: string;
}

export type MarkupChild = MarkupElement | MarkupText;

function decodeEntities(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|#39|#x22);/g,
    (_match, entity: string) => {
      switch (entity) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
        case '#x22':
          return '"';
        default:
          return "'";
      }
    },
  );
}

/** Parse compiler markup into a root list for server materialization. */
export function parseMarkup(markup: string): MarkupChild[] {
  const nodes: MarkupChild[] = [];
  walkMarkup(markup, (tag, ns, source, count) => {
    if (tag === null) {
      nodes.push({ type: 'text', text: decodeEntities(source) });
    } else {
      const attrs: [string, string][] = [];
      const attributes = /([^\s=/>"'<]+)(?:=(["'])(.*?)\2)?/gs;
      for (const attribute of source.matchAll(attributes)) {
        attrs.push([attribute[1]!, decodeEntities(attribute[3] ?? '')]);
      }
      const children = count === 0 ? [] : nodes.splice(nodes.length - count);
      nodes.push({ type: 'element', tag, ns, attrs, children });
    }
  });
  return nodes;
}
