import { describe, expect, it } from 'vitest';
import { compileModulesDetailed, emitInitialHtml } from '../packages/compiler/src';

function compile(app: string, modules: Record<string, string> = {}, entry = '') {
  return compileModulesDetailed({
    './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; ${entry} mount('root', App);`,
    './App.tsx': app,
    ...modules,
  });
}

describe('initial content and browser requirements', () => {
  it('emits hello HTML from a compiler plan independent of the DOM factory', () => {
    const result = compile(`export function App() { return <h1>Hello</h1>; }`);
    expect(result.initialRender.kind).toBe('html');
    expect(emitInitialHtml(result.initialRender)).toBe('<h1>Hello</h1>');
    // Direct JS entry consumers retain the existing factory ABI.
    expect(result.output['./App.tsx']).toContain('registerRootFactory');
  });

  it('plans cross-module composition, closed props, defaults and children', () => {
    const result = compile(`
      import { Card } from './Card'; import { title } from './copy';
      export function App() { const label = title; return <main><Card title={label}><em>Body</em></Card><Card /></main>; }
    `, {
      './Card.tsx': `export function Card({title = 'Default', children}) { return <section><h2>{title}</h2>{children}</section>; }`,
      './copy.ts': `export const title = 'Hello & <friends>';`,
    });
    expect(emitInitialHtml(result.initialRender)).toBe('<main><section><h2>Hello &amp; &lt;friends&gt;</h2><em>Body</em></section><section><h2>Default</h2></section></main>');
  });

  it('keeps shadowed props and repeated component instances separate', () => {
    const result = compile(`const label = 'outer'; function Label({label}) { return <span>{label}</span>; }
      export function App() { return <div><Label label="one"/><Label label="two"/><b>{label}</b></div>; }`);
    expect(emitInitialHtml(result.initialRender)).toBe('<div><span>one</span><span>two</span><b>outer</b></div>');
  });

  it('uses the shared positional prop and whole-envelope default contracts', () => {
    const result = compile(`function Label(title='untitled', suffix='!'){return <h2>{title}{suffix}</h2>;}
      function Card({title}={title:'default'}){return <p>{title}</p>;}
      export function App(){return <main><Label title="one"/><Label suffix="?"/><Card/><Card title="two"/></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toBe('<main><h2>one!</h2><h2>untitled?</h2><p>default</p><p>two</p></main>');
    expect(emitInitialHtml(compile(`export function App({title}={title:'root'}){return <h1>{title}</h1>;}`).initialRender))
      .toBe('<h1>root</h1>');
    expect(compile(`export function App({title='unsafe'}){return <h1>{title}</h1>;}`).initialRender.kind).toBe('browser');
  });

  it('supports import-then-export component aliases', () => {
    const result = compile(`import { Heading } from './barrel'; export function App() { return <Heading text="Hi"/>; }`, {
      './barrel.ts': `import { Label } from './Label'; export { Label as Heading };`,
      './Label.tsx': `export function Label(props) { return <h2>{props.text}</h2>; }`,
    });
    expect(emitInitialHtml(result.initialRender)).toBe('<h2>Hi</h2>');
  });

  it('normalizes JSX text and escapes text and attribute values separately', () => {
    const result = compile(`export const App = () => <div title={'"<&'}>
      Hello
      <span>{'<>&'}</span>
    </div>;`);
    expect(emitInitialHtml(result.initialRender)).toBe('<div title="&quot;&lt;&amp;">Hello<span>&lt;&gt;&amp;</span></div>');
  });

  it('preserves class string normalization and declines DOM property coercions', () => {
    expect(emitInitialHtml(compile(`export function App(){return <div className="  a  b  "/>;}`).initialRender))
      .toBe('<div class="a  b"></div>');
    for (const attribute of ['disabled=""', 'readOnly=""', 'hidden=""', 'value="text"']) {
      expect(emitInitialHtml(compile(`export function App(){return <input ${attribute}/>;}`).initialRender)).toBeNull();
    }
  });

  it('does not change adjacent expression coercion while separating the backends', () => {
    expect(compile(`export function App(){const n=1;return <div>{n}{2} items</div>;}`).initialRender.kind).toBe('browser');
    expect(compile(`export function App(){const value=null;return <div>Value: {value}</div>;}`).initialRender.kind).toBe('browser');
  });

  it('preserves case-insensitive HTML attribute overrides and removals', () => {
    expect(emitInitialHtml(compile(`export function App(){return <div data-label="one" DATA-LABEL="two"/>;}`).initialRender))
      .toBe('<div data-label="two"></div>');
    expect(emitInitialHtml(compile(`export function App(){return <div data-label="one" DATA-LABEL={null}/>;}`).initialRender))
      .toBe('<div></div>');
    expect(emitInitialHtml(compile(`export function App(){return <div data-label="one" DATA-LABEL="two" data-label="three"/>;}`).initialRender))
      .toBe('<div data-label="three"></div>');
  });

  it('does not fold prototype reads into absent object properties', () => {
    for (const source of [
      `const value={};return <h1>{value.toString}</h1>;`,
      `const value={__proto__:'wrong'};return <h1>{value.__proto__}</h1>;`,
    ]) expect(compile(`export function App(){${source}}`).initialRender.kind).toBe('browser');
  });

  it.each([
    ['event', `export function App(){ return <button onClick={() => {}}>Click</button>; }`],
    ['ref', `export function App(){ let node=null; return <div ref={node}/>; }`],
    ['lifecycle', `export function App(){ $effect(() => {}); return <h1>Hello</h1>; }`],
    ['unknown', `export function App(){ return <h1>{Date.now()}</h1>; }`],
    ['unknown', `export function App(){ const value = {get text(){return 'Hi'}}; return <h1>{value.text}</h1>; }`],
  ])('retains browser execution for %s work', (kind, source) => {
    const result = compile(source);
    expect(result.initialRender.kind).toBe('browser');
    if (result.initialRender.kind === 'browser') expect(result.initialRender.requirements[0]?.kind).toBe(kind);
    expect(emitInitialHtml(result.initialRender)).toBeNull();
  });

  it('retains events in a descendant under a static parent', () => {
    const result = compile(`import { Counter } from './Counter'; export function App(){ return <main><h1>Static</h1><Counter/></main>; }`, {
      './Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
    });
    expect(result.initialRender.kind).toBe('browser');
  });

  it('preserves browser setup even when no rendered node reads its result', () => {
    const result = compile(`export function App(){ return <h1>Hello</h1>; }`, {}, `console.log('boot');`);
    expect(result.initialRender.kind).toBe('browser');
  });

  it('does not run a top-level initializer or ignore dependency side effects', () => {
    const result = compile(`import './setup'; export function App(){return <h1>Hello</h1>;}`, {
      './setup.ts': `globalThis.__initialRenderSideEffect = true;`,
    });
    expect(result.initialRender.kind).toBe('browser');
    expect((globalThis as Record<string, unknown>).__initialRenderSideEffect).toBeUndefined();
  });

  it('does not assume external imports are pure', () => {
    const result = compile(`import 'external-library'; export function App(){return <h1>Hello</h1>;}`);
    expect(result.initialRender.kind).toBe('browser');
  });

  it('does not remove mount options', () => {
    const result = compileModulesDetailed({
      './main.ts': `import {mount} from '@memoized-dom/runtime'; import {App} from './App'; mount('root',App,{onHydrateError:console.error});`,
      './App.tsx': `export function App(){return <h1>Hello</h1>;}`,
    });
    expect(result.initialRender.kind).toBe('browser');
  });

  it.each([
    `<p><div>Parser closes p</div></p>`, `<table><tbody><tr><td>Cell</td></tr></tbody></table>`,
    `<script>{'alert(1)'}</script>`, `<svg><circle/></svg>`, `<textarea>{'Hi'}</textarea>`,
    `<span>{'\u0000'}</span>`,
  ])('declines HTML shapes whose parsing can change the DOM: %s', jsx => {
    const result = compile(`export function App(){return ${jsx};}`);
    expect(emitInitialHtml(result.initialRender)).toBeNull();
  });
});
