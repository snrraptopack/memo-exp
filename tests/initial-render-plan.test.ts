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

  it('renders unchanged let variables and primitive derivations without browser execution', () => {
    const result = compile(`import {prefix} from './copy'; export function App(){
      let name='Ada'; const greeting=prefix+name; const total=(3+4)*2;
      return <main><h1>{greeting}</h1><p>{total}</p><span>{typeof name}</span></main>;
    }`, { './copy.ts': `export const prefix='Hello ';` });
    expect(emitInitialHtml(result.initialRender)).toBe('<main><h1>Hello Ada</h1><p>14</p><span>string</span></main>');
    expect(result.initialRender.kind).toBe('html');
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
    expect(result.initialRender.kind).toBe('mixed');
    expect(emitInitialHtml(result.initialRender)).toBe('<main><h1>Static</h1><!--mmd:initial:0--></main>');
    expect(result.output['./App.tsx']).toContain('Static');
    expect(result.initialBrowserOutput?.['./App.tsx']).not.toContain('Static');
    expect(result.initialBrowserOutput?.['./App.tsx']).toContain('adoptInitialRoot');
    expect(result.initialBrowserMaps?.['./App.tsx']?.sourcesContent?.[0]).toContain('<h1>Static</h1>');
  });

  it('preserves an interactive instance identity after an omitted static instance of the same component', () => {
    const result=compile(`import {Card} from './Card';export function App(){return <main><Card live={false}/><Card live={true}/></main>;}`, {
      './Card.tsx': `export function Card({live}){let n=0;return <section>{live?<button onClick={()=>n++}>{n}</button>:<span>Static card</span>}</section>;}`,
    });
    expect(emitInitialHtml(result.initialRender)).toBe('<main><section><span>Static card</span></section><!--mmd:initial:0--></main>');
    expect(result.initialBrowserOutput?.['./App.tsx']).toContain('/Card[1]');
  });

  it('keeps unchanged names in an HTML shell around repeated interactive children', () => {
    const result = compile(`import {Counter} from './Counter'; export function App(){let name='Ada';
      return <main><h1>{'Hello '+name}</h1><Counter/><Counter/></main>;}`, {
      './Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
    });
    expect(emitInitialHtml(result.initialRender)).toBe('<main><h1>Hello Ada</h1><!--mmd:initial:0--><!--mmd:initial:1--></main>');
    expect(result.initialBrowserOutput?.['./App.tsx']).toContain('/Counter[1]');
  });

  it.each([
    `import {name,change} from './state'; export function App(){return <main><h1>{name}</h1><Counter action={change}/></main>;}`,
    `export function App(){let name='Ada';function change(){name='Grace';}return <main><h1>{name}</h1><Counter action={change}/></main>;}`,
    `export function App(){let name='Ada';function change(){eval('name="Grace"');}return <main><h1>{name}</h1><Counter action={change}/></main>;}`,
    `export function App(){const person={name:'Ada'};return <main><h1>{person.name}</h1><Counter/></main>;}`,
    `export function App(){return <main>{true&&<Counter/>}</main>;}`,
    `function Card({children}){return <section>{children}</section>;}export function App(){return <main><Card><Counter/></Card></main>;}`,
  ])('does not extract an unproved interaction boundary', source => {
    const result = compile(`import {Counter} from './Counter'; ${source}`, {
      './Counter.tsx': `export function Counter({action}){let n=0;return <button onClick={()=>{n++;action?.();}}>{n}</button>;}`,
      './state.ts': `export let name='Ada';export function change(){name='Grace';}`,
    });
    expect(result.initialRender.kind).toBe('browser');
    expect(result.initialBrowserOutput).toBeUndefined();
  });

  it('does not replace component ref or routing semantics with ordinary HTML attributes', () => {
    expect(compile(`function Card({ref}){return <span ref={ref}>Hi</span>;}export function App(){return <Card ref={()=>{}}/>;}`).initialRender.kind).toBe('browser');
    expect(compile(`export function App(){return <main route="/"><h1>Hello</h1></main>;}`).initialRender.kind).toBe('browser');
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
