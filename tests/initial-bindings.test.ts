import { describe, expect, it } from 'vitest';
import { compileModulesDetailed, emitInitialHtml } from '../packages/compiler/src';

const compileInitial: typeof compileModulesDetailed = (sources, options = {}) =>
  compileModulesDetailed(sources, { initialContent: true, ...options });

function compile(app: string) {
  return compileInitial({
    './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
    './App.tsx': app,
  });
}

describe('initial HTML and browser bindings', () => {
  it('selects the initial mount operation in the sole document output', () => {
    const result = compile(`export function App(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`);
    expect(result.initialContent).toBe(true);
    expect(result.output?.['./main.ts']).toContain('mountInitial as mount');
  });

  it('preserves a mount alias and a configured runtime path', () => {
    const result = compileInitial({
      './main.ts': `import {mount as attach} from 'custom-runtime';import {App} from './App';attach('root',App);`,
      './App.tsx': `export function App(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
    }, { runtimePath: 'custom-runtime' });
    expect(result.initialRender.kind).toBe('bindings');
    expect(result.output?.['./main.ts']).toContain('mountInitial as attach');
    expect(result.initialContent).toBe(true);
  });

  it('binds a static root and its composed live child', () => {
    const result = compileInitial({
      './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
      './App.tsx': `import {Counter} from './Counter';export function App(){return <main><h1>Static</h1><Counter/></main>;}`,
      './Counter.tsx': `export function Counter(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
    });
    expect(result.initialRender.kind).toBe('bindings');
    expect(result.output?.['./main.ts']).toContain('mountInitial as mount');
    expect(result.output?.['./App.tsx']).toContain('bindInitialNodes');
    expect(result.output?.['./Counter.tsx']).toContain('bindInitialNodes');
  });

  it('keeps hot and server entries on the general mounting path', () => {
    for (const options of [{ hot: true }, { routedEnvironment: 'server' as const }]) {
      const result = compileInitial({
        './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
        './App.tsx': `export function App(){let n=0;return <button onClick={()=>n++}>{n}</button>;}`,
      }, options);
      expect(result.initialContent).toBe(false);
      expect(result.output['./main.ts']).not.toContain('mountInitial');
    }
  });

  it('emits a live counter as HTML and binds its existing nodes', () => {
    const result=compile(`export function App(){let n=0;return <main><h1 title="Static title">Static heading</h1>
      <button onClick={()=>n++}>Add</button><p>{n}</p></main>;}`);
    expect(result.initialRender.kind).toBe('bindings');
    expect(emitInitialHtml(result.initialRender)).toBe('<main><h1 title="Static title">Static heading</h1><button>Add</button><p>0</p></main>');
    const browser=result.output?.['./App.tsx'];
    expect(browser).toContain('bindInitialNodes');
    expect(browser).not.toMatch(/createElement|createTextNode|appendChild|materializeMarkup/);
    expect(browser).not.toContain('Static heading');
    expect(browser).not.toContain('Static title');
    expect(browser).not.toContain('"Add"');
  });

  it('retains existing module state routing in its browser program', () => {
    const result=compile(`let n=0;export function App(){return <main><button onClick={()=>n++}>Add</button><p>{n}</p></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toBe('<main><button>Add</button><p>0</p></main>');
    expect(result.output?.['./App.tsx']).toContain('bindInitialNodes');
    expect(result.output?.['./App.tsx']).toContain('installAccessTable');
  });

  it('emits dynamic attribute writes once in the browser updater', () => {
    const result=compile(`export function App(){let n=0;return <button className={'count-'+n} onClick={()=>n++}>{n}</button>;}`);
    expect(emitInitialHtml(result.initialRender)).toBe('<button class="count-0">0</button>');
    expect(result.output?.['./App.tsx'].match(/setClassValue/g)).toHaveLength(1);
  });

  it('omits unchanged names and their derived text/attributes from browser work', () => {
    const result=compile(`export function App(){let name='Ada';const greeting='Hello '+name;let n=0;
      return <main><h1 title={greeting}>{greeting}</h1><button onClick={()=>n++}>{n}</button></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toContain('<h1 title="Hello Ada">Hello Ada</h1>');
    const browser=result.output?.['./App.tsx'];
    expect(browser).toContain('bindInitialNodes');
    expect(browser).not.toContain('setAttribute');
    expect(browser).not.toContain('"h1"');
    expect(browser?.match(/setTextData/g)).toHaveLength(1);
  });

  it('retains derived and aliased state that can change through a captured helper', () => {
    const result=compile(`export function App(){let n=1;const doubled=n*2;const alias=doubled;
      function add(){n++;}return <main><h1 title={alias}>{alias}</h1><button onClick={add}>Add</button></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toContain('<h1 title="2">2</h1>');
    const browser=result.output?.['./App.tsx'];
    expect(browser).toContain('setTextData');
    expect(browser).toContain('"h1"');
  });

  it('keeps object destructuring on the live path when the source can mutate', () => {
    const result=compile(`export function App(){const data={name:'Ada'};const {name}=data;
      return <main><h1>{name}</h1><button onClick={()=>{data.name='Grace';}}>Rename</button></main>;}`);
    expect(result.output?.['./App.tsx']).toContain('setTextData');
  });

  it('preserves the compiler shared adjacent-text expression semantics', () => {
    const result=compile(`export function App(){let n=1;return <main><button onClick={()=>n++}>Add</button>
      <p>{n}{2} items</p><b>{n}{2}</b></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toBe('<main><button>Add</button><p>3 items</p><b>12</b></main>');
  });

  it('provides a binding position for an initially empty dynamic text node', () => {
    const result=compile(`export function App(){let name='';return <main><button onClick={()=>name='Ada'}>Name</button><p>{name}</p></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toContain('<p><!--mmd:empty--></p>');
    expect(result.output?.['./App.tsx']).toContain('bindInitialNodes');
  });

  it('adopts unchanged empty text without adding an update', () => {
    const result=compile(`export function App(){const name='';let n=0;return <main><p>{name}</p><button onClick={()=>n++}>{n}</button></main>;}`);
    expect(emitInitialHtml(result.initialRender)).toContain('<!--mmd:empty-->');
    expect(result.output?.['./App.tsx'].match(/setTextData/g)).toHaveLength(1);
    expect(result.output?.['./App.tsx'].match(/"#text"/g)).toHaveLength(2);
  });

  it.each([
    `let n=0;return <main><input type="file" value={n}/><button onClick={()=>n++}>Add</button></main>;`,
    `let n=0;return <main style={{color:'red'}}><button onClick={()=>n++}>Add</button></main>;`,
    `let n=Date.now();return <button onClick={()=>n++}>{n}</button>;`,
    `let n=0;const setup=()=>{};$effect(setup);return <button onClick={()=>n++}>{n}</button>;`,
    `let n=0;const target=()=>null;return <button ref={target()} onClick={()=>n++}>{n}</button>;`,
    `let n=0;return <main><button onClick={()=>n++}>Add</button>{n?<><p>yes</p></>:<p>no</p>}</main>;`,
    `let n=0;const label='last';return <button data-x={n} DATA-X={label} onClick={()=>n++}>Add</button>;`,
  ])('keeps the creation program when initial binding semantics are unproved', body => {
    const result=compile(`export function App(){${body}}`);
    expect(result.initialContent).toBe(false);
  });
});
