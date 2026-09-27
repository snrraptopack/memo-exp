import { afterEach, describe, expect, it } from 'vitest';
import { compile } from '../packages/compiler/src/compile';
import * as runtime from '@memoized-dom/runtime';
import { renderToString } from '@memoized-dom/server';

const padding = '<span data-kind="item">item</span>'.repeat(16);

function compiled(body: string): (id: string, parent: string | null) => Node {
  const code = compile(`export function App() { return ${body}; }`);
  return new Function('_MD', code
    .replace(/^import \* as _MD from .*;$/m, '')
    .replace(/export function /g, 'function ')
    + '\nreturn App;')(runtime);
}

afterEach(() => runtime.unregisterSubtree('App'));

describe('static markup preserves imperative DOM semantics', () => {
  it.each(['p', 'a', 'button', 'li', 'h1', 'form'])(
    'preserves parser-sensitive nesting of <%s>', tag => {
      const child = tag === 'p' ? 'div' : tag;
      const app = compiled(`<${tag}><${child}>${padding}</${child}></${tag}>`);
      const root = app('App', null) as Element;
      expect(root.localName).toBe(tag);
      expect((root.firstChild as Element).localName).toBe(child);
      expect(root.querySelectorAll('span')).toHaveLength(16);
    },
  );

  it('preserves static empty text nodes without placeholder characters', () => {
    const app = compiled(`<div><section>${padding}</section><span>{''}</span></div>`);
    const root = app('App', null) as Element;
    expect(root.lastChild!.textContent).toBe('');
    expect(root.lastChild!.childNodes).toHaveLength(1);
    expect(root.lastChild!.firstChild!.nodeType).toBe(3);
    expect(renderToString(app)).not.toContain('\u200b');
  });

  it('preserves SVG local names and foreignObject namespaces', () => {
    const app = compiled(`<div><section>${padding}</section><svg>
      <linearGradient>${'<stop />'.repeat(16)}</linearGradient>
      <foreignObject><div>${padding}</div></foreignObject>
    </svg></div>`);
    const root = app('App', null) as Element;
    const svg = root.querySelector('svg')!;
    const gradient = svg.firstChild as Element;
    expect(gradient.localName).toBe('linearGradient');
    expect(gradient.namespaceURI).toBe('http://www.w3.org/2000/svg');
    const foreignObject = svg.lastChild as Element;
    expect(foreignObject.localName).toBe('foreignObject');
    expect(foreignObject.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect((foreignObject.firstChild as Element).namespaceURI)
      .toBe('http://www.w3.org/1999/xhtml');
  });

  it('preserves text and attribute characters normalized by HTML parsing', () => {
    const app = compiled(`<div><section>${padding}</section>
      <span data-value={'a\\rb\\0c'}>{'a\\rb\\0c'}</span>
    </div>`);
    const root = app('App', null) as Element;
    expect(root.lastChild!.textContent).toBe('a\rb\0c');
    expect((root.lastChild as Element).getAttribute('data-value')).toBe('a\rb\0c');
  });

  it('creates cached templates separately for each render document', () => {
    const markup = '<div><span>document isolation</span></div>';
    const first = document.implementation.createHTMLDocument('first');
    const second = document.implementation.createHTMLDocument('second');
    const from = (document: Document) => runtime.runWithRenderEnvironment(
      { document }, () => runtime.materializeMarkup(markup),
    );
    from(first);
    const nodes = from(second);
    // Template contents use an inert owner document, so compare against a
    // template created by this host rather than the host Document itself.
    const template = second.createElement('template');
    expect(nodes.at(-1)!.ownerDocument).toBe(template.content.ownerDocument);
  });
});
