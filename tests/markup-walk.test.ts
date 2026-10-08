import { describe, expect, it } from 'bun:test';
import { walkMarkup } from '../packages/runtime/src/markup-walk';
import { parseMarkup, type MarkupChild } from '../packages/runtime/src/markup-parse';

function nativeNodes(markup: string): Node[] {
  const template = document.createElement('template');
  template.innerHTML = markup;
  const nodes: Node[] = [];
  const collect = (parent: Node): void => {
    for (const child of parent.childNodes) {
      collect(child);
      nodes.push(child);
    }
  };
  collect(template.content);
  return nodes;
}

describe('compiler markup traversal', () => {
  it.each([
    '<div title="a > b &amp; c" disabled><span>one &lt; two</span><img src="logo.png"/>tail</div>',
    "leading<input value='a > b' checked><br><p data-note=\"a &#39; b &quot; c\">last</p>",
    '<main><svg><circle cx="5"/><path d="M0 0"></path></svg></main>',
    '<section><div></div><div><b>bold</b><i>italic</i></div></section><hr>end',
  ])('matches native node order, namespaces and decoded server values: %s', markup => {
    const native = nativeNodes(markup);
    const claims: Array<{ type: number; tag?: string; ns?: string }> = [];
    walkMarkup(markup, (tag, ns) => claims.push(tag === null
      ? { type: 3 } : { type: 1, tag, ns }));
    expect(claims).toEqual(native.map(node => node.nodeType === 3
      ? { type: 3 }
      : { type: 1, tag: (node as Element).localName, ns: (node as Element).namespaceURI }));

    const parsed: MarkupChild[] = [];
    const collect = (children: MarkupChild[]): void => {
      for (const child of children) {
        if (child.type === 'element') collect(child.children);
        parsed.push(child);
      }
    };
    collect(parseMarkup(markup));
    expect(parsed.map(child => child.type === 'text'
      ? child.text : Object.fromEntries(child.attrs)))
      .toEqual(native.map(node => node.nodeType === 3
        ? node.textContent : Object.fromEntries([...(node as Element).attributes]
          .map(attribute => [attribute.name, attribute.value]))));
  });
});
