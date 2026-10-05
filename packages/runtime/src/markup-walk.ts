/** Shared post-order traversal of compiler-generated markup, without a tree. */
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
export const HTML_NS = 'http://www.w3.org/1999/xhtml';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

interface Frame {
  tag: string;
  ns: string;
  source: string;
  children: number;
}

/**
 * Text has a null tag and raw text as its source. Elements have their raw
 * attribute source and direct child count. Consumers decode values only when
 * needed. The grammar is compiler output, not arbitrary user HTML.
 */
export function walkMarkup(
  markup: string,
  visit: (tag: string | null, ns: string, source: string, children: number) => void,
): void {
  const stack: Frame[] = [];
  const emit = (tag: string | null, ns: string, source: string, children: number): void => {
    visit(tag, ns, source, children);
    const parent = stack.at(-1);
    if (parent !== undefined) parent.children++;
  };
  const close = (): void => {
    const frame = stack.pop();
    if (frame !== undefined) emit(frame.tag, frame.ns, frame.source, frame.children);
  };
  // Quoted attribute values may contain angle brackets. They remain part of
  // the opening token rather than becoming text or closing the tag early.
  const tokens = /<\/?([a-zA-Z][a-zA-Z0-9._:-]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>|[^<]+/g;
  for (const token of markup.matchAll(tokens)) {
    const source = token[0];
    if (token[1] === undefined) {
      emit(null, HTML_NS, source, 0);
    } else if (source.startsWith('</')) {
      close();
    } else {
      const tag = token[1].toLowerCase();
      let ns = stack.at(-1)?.ns ?? HTML_NS;
      if (tag === 'svg') ns = SVG_NS;
      else if (tag === 'math') ns = MATH_NS;
      else if (tag === 'foreignobject') ns = HTML_NS;
      const attributes = source.slice(1 + token[1].length, source.endsWith('/>') ? -2 : -1);
      if (source.endsWith('/>') || VOID_TAGS.has(tag)) emit(tag, ns, attributes, 0);
      else stack.push({ tag, ns, source: attributes, children: 0 });
    }
  }
  while (stack.length > 0) close();
}
