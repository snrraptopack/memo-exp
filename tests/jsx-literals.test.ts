import { afterEach, describe, expect, it } from 'vitest';
import { compile, compileModulesDetailed, emitInitialHtml, experimentalTsrxEstreeFrontend } from '../packages/compiler/src';
import * as runtime from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { renderToString } from '@memoized-dom/server';

function app(source: string, tsrx = false): (id: string, parent: string | null) => Node {
  const code = compile(source, tsrx ? {frontend: experimentalTsrxEstreeFrontend} : {});
  return new Function('_MD', code.replace(/^import \* as _MD from .*;$/m, '')
    .replace(/export function /g, 'function ') + '\nreturn App;')(runtime);
}

afterEach(() => {
  runtime.unregisterSubtree('App');
  document.body.replaceChildren();
});

describe('authored JSX literal values', () => {
  it.each([false, true])('decodes entities once across props, slots and ordinary DOM (TSRX: %s)', tsrx => {
    const App = app(`function Box({title,children}){return <section title={title}>{children}</section>;}
      export function App(){return <main><Box title="A &amp; B &amp;amp;">
        <p>A&nbsp;&nbsp;B &copy; &#x1F642; &amp;amp; &unknown;</p>
        <span>{'&amp;'}</span></Box></main>;}`, tsrx);
    const root = App('App', null) as Element;
    expect(root.querySelector('section')!.getAttribute('title')).toBe('A & B &amp;');
    expect(root.querySelector('p')!.textContent).toBe('A\u00a0\u00a0B © 🙂 &amp; &unknown;');
    expect(root.querySelector('span')!.textContent).toBe('&amp;');
  });

  it('preserves explicit space entities in component-only text children', () => {
    const App = app(`function Box({children}){return <section>{children}</section>;}
      export function App(){return <main><Box>&nbsp;&#32;&#32;</Box></main>;}`);
    expect((App('App', null) as Element).querySelector('section')!.textContent).toBe('\u00a0  ');
  });

  it('uses the same values in initial HTML planning', () => {
    const result = compileModulesDetailed({
      './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
      './App.tsx': `function Box({title,children}){return <section title={title}>{children}</section>;}
        export function App(){return <main><Box title="A &amp; B"><p>Ready &amp; waiting.</p>
          <span>&nbsp;&#32;&#32;</span><b>{'&amp;'}</b></Box></main>;}`,
    }, {initialContent:true});
    expect(emitInitialHtml(result.initialRender)).toBe('<main><section title="A &amp; B"><p>Ready &amp; waiting.</p><span>\u00a0  </span><b>&amp;amp;</b></section></main>');
  });

  it('retains decoded values and node identity through markup SSR adoption', () => {
    const source = `export function App(){return <main title="A &amp; B">${
      '<article><h2>Ready &amp; waiting.</h2><p>&nbsp;&#32;&#32;&lt; &#x1F642;</p></article>'.repeat(16)}</main>;}`;
    expect(compile(source)).toContain('materializeMarkup');
    const App = app(source);
    runtime.registerRootFactory(App, {id:'App',create:()=>App('App',null)});
    const html = renderToString(App, {markers:true});
    expect(html).toContain('Ready &amp; waiting.');
    expect(html).not.toContain('Ready &amp;amp; waiting.');
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const initial = [...host.querySelectorAll('*')];
    const mounted = runtime.mount(host, App, {onHydrateError(error){throw error;}});
    try {
      expect([...host.querySelectorAll('*')].every((node, index) => node === initial[index])).toBe(true);
      expect(host.querySelector('main')!.getAttribute('title')).toBe('A & B');
      expect(host.querySelector('p')!.textContent).toBe('\u00a0  < 🙂');
    } finally { mounted.unmount(); }
  });
});
