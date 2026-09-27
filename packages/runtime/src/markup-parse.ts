/**
 * markup-parse.ts - shared parser for compiler-generated markup strings.
 *
 * The grammar is restricted — elements with double-quoted attributes, text
 * runs, and a fixed entity set — because the input is always compiler
 * output, never arbitrary user HTML. No error recovery.
 *
 * Consumers: hydration claims (browser hydrate bundle) and StringDocument's
 * materializeMarkup (server bundle). The client-create path uses native
 * <template> parsing instead, so this module never ships to browser
 * bundles unless hydration is installed.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
export const HTML_NS = 'http://www.w3.org/1999/xhtml';

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

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

interface ParsedTag {
  name: string;
  attrs: [string, string][];
  /** Index one past the tag's closing '>'. */
  next: number;
  selfClosing: boolean;
}

function parseTag(markup: string, start: number): ParsedTag | null {
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9._:-]*/.exec(markup.slice(start));
  if (nameMatch === null) return null;
  const name = nameMatch[0];
  let i = start + name.length;
  const attrs: [string, string][] = [];
  for (;;) {
    const ws = /^\s*/.exec(markup.slice(i))!;
    i += ws[0].length;
    if (markup[i] === '>') {
      return { name, attrs, next: i + 1, selfClosing: false };
    }
    if (markup.startsWith('/>', i)) {
      return { name, attrs, next: i + 2, selfClosing: true };
    }
    const attrName = /^[^\s=/>"'<]+/.exec(markup.slice(i));
    if (attrName === null) return null;
    i += attrName[0].length;
    if (markup[i] === '=') {
      i++;
      const quote = markup[i];
      if (quote !== '"' && quote !== "'") return null;
      const close = markup.indexOf(quote, i + 1);
      if (close === -1) return null;
      attrs.push([attrName[0], decodeEntities(markup.slice(i + 1, close))]);
      i = close + 1;
    } else {
      attrs.push([attrName[0], '']);
    }
  }
}

/**
 * Parse compiler markup into a root list. Elements retain their children;
 * walk post-order for the compiler's creation order.
 */
export function parseMarkup(markup: string): MarkupChild[] {
  interface Frame {
    tag: string;
    ns: string;
    attrs: [string, string][];
    children: MarkupChild[];
  }
  const roots: MarkupChild[] = [];
  const stack: Frame[] = [];
  const top = (): MarkupChild[] =>
    stack.length === 0 ? roots : stack.at(-1)!.children;

  let i = 0;
  while (i < markup.length) {
    const lt = markup.indexOf('<', i);
    const textEnd = lt === -1 ? markup.length : lt;
    if (textEnd > i) {
      const text = decodeEntities(markup.slice(i, textEnd));
      if (text !== '') top().push({ type: 'text', text });
      i = textEnd;
      continue;
    }
    if (markup.startsWith('</', i)) {
      const gt = markup.indexOf('>', i + 2);
      const frame = stack.pop();
      if (frame !== undefined) {
        top().push({
          type: 'element',
          tag: frame.tag,
          ns: frame.ns,
          attrs: frame.attrs,
          children: frame.children,
        });
      }
      i = (gt === -1 ? markup.length : gt) + 1;
      continue;
    }
    const parsed = parseTag(markup, i + 1);
    if (parsed === null) {
      const gt = markup.indexOf('>', i);
      i = gt === -1 ? markup.length : gt + 1;
      continue;
    }
    const parentNs = stack.length === 0 ? HTML_NS : stack.at(-1)!.ns;
    const lower = parsed.name.toLowerCase();
    let ns = parentNs;
    if (lower === 'svg') ns = SVG_NS;
    else if (lower === 'math') ns = MATH_NS;
    else if (lower === 'foreignobject') ns = HTML_NS;

    i = parsed.next;
    if (parsed.selfClosing || VOID_TAGS.has(lower)) {
      top().push({
        type: 'element',
        tag: lower,
        ns,
        attrs: parsed.attrs,
        children: [],
      });
    } else {
      stack.push({ tag: lower, ns, attrs: parsed.attrs, children: [] });
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    top().push({
      type: 'element',
      tag: frame.tag,
      ns: frame.ns,
      attrs: frame.attrs,
      children: frame.children,
    });
  }
  return roots;
}
