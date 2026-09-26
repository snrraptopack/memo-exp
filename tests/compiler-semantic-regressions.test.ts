import { describe, expect, it } from 'vitest';
import { compile, compileDetailed } from '../packages/compiler/src/compile';
import { compileModules, compileModulesDetailed } from '../packages/compiler/src/linker';
import { analyzeScope, parseEstreeOrThrow } from '../packages/compiler/src/ast';

// Execute emitted JavaScript directly: no TS loader may hide incomplete erasure.
function execute(code: string, runtime: object = {}, onGet = () => {}) {
  const defaults = {
    setTextData(node: Text, value: unknown) {
      const next = value == null || typeof value === 'boolean' ? '' : String(value);
      if (node.data !== next) node.data = next;
    },
    materializeMarkup(markup: string): Node[] {
      const template = document.createElement('template');
      template.innerHTML = markup;
      const nodes: Node[] = [];
      const collect = (node: Node | null): void => {
        for (let n = node; n !== null; n = n.nextSibling) {
          collect(n.firstChild);
          nodes.push(n);
        }
      };
      collect(template.content.firstChild);
      return nodes;
    },
  };
  return new Function('_MD', 'onGet', code
    .replace(/^import \* as _MD from .*;$/m, '')
    .replace(/export function /g, 'function ')
    + '\nreturn { App: typeof App === "undefined" ? undefined : App, read: typeof read === "undefined" ? undefined : read };'
  )({ ...defaults, ...runtime }, onGet);
}

function mount(body: string, setup = 'let count = 0;', effect = false, asyncHandler = false) {
  const renders: Array<() => void> = [];
  const effects: Array<() => unknown> = [];
  const commits: number[] = [];
  let getters = 0;
  let api: ReturnType<typeof execute>;
  const notify = () => {
    commits.push(api.read());
    for (const render of renders) render();
  };
  const runtime = {
    installAccessTable() {},
    getActiveEnvironment: () => ({ document }),
    register: ({ render }: { render: () => void }) => renders.push(render),
    registerEffect: (_id: string, _parent: string, fn: () => unknown) => effects.push(fn),
    effectAssignmentChanged: (a: unknown, b: unknown) => !Object.is(a, b),
    commitWrites: notify,
    markDirty: notify,
    markDirtySubtree: notify,
  };
  const source = `${setup}
    export function read() { return count; }
    export function App() {
      ${effect ? `effect(() => { ${body} });` : ''}
      return <button ${effect ? '' : `onClick={${asyncHandler ? 'async ' : ''}() => { ${body} }}`}>{count}</button>;
    }`;
  api = execute(compile(source), runtime, () => getters++);
  const button = api.App('App', null) as HTMLButtonElement;
  return {
    button, commits, read: api.read,
    run: () => effect ? effects[0]!() : button.onclick!.call(button, new MouseEvent('click')),
    getters: () => getters,
  };
}

describe('compiler completion semantics', () => {
  it('keeps a simple subscription callback on the straight-line hot path', () => {
    const code = compile(`export function LiveFeed() {
      let status = 'idle';
      subscribe((val) => { status = val; });
      return <output>{status}</output>;
    }`);
    const callback = code.slice(code.indexOf('subscribe('), code.indexOf(');', code.indexOf('subscribe(')));
    expect(callback).toMatch(/status = val;\s+_MD\w*\.markDirty/);
    expect(callback).not.toContain('try');
  });

  it.each(['() => count++', 'increment'])('preserves concise handler return values: %s', handler => {
    const api = execute(compile(`let count = 0; const increment = () => count++;
      export function read() { return increment(); }
      export function App() { return <button onClick={${handler}}>{count}</button>; }`), {
      installAccessTable() {}, register() {}, commitWrites() {},
      getActiveEnvironment: () => ({ document }),
    });
    const button = api.App('App', null) as HTMLButtonElement;
    expect(button.onclick!.call(button, new MouseEvent('click'))).toBe(0);
    expect(api.read()).toBe(1);
  });

  it.each([
    ['return count++;', 0],
    ['try { return 7; } finally { count++; }', 7],
    ['try { return count++; } finally { count += 2; }', 0],
    ['try { return 7; } finally { count++; return 8; }', 8],
  ])('notifies after all mutations in %s', (body, result) => {
    const app = mount(body as string);
    expect(app.run()).toBe(result);
    expect(app.commits).toEqual([app.read()]);
    expect(app.button.textContent).toBe(String(app.read()));
  });

  it.each([
    'count++; throw new Error("original");',
    'count++; (() => { throw new Error("original"); })();',
    'try { count++; } finally { throw new Error("original"); }',
  ])('preserves the original exception without generated wrappers: %s', body => {
    const app = mount(body);
    expect(app.run).toThrow('original');
    expect(app.read()).toBe(1);
    expect(app.commits).toEqual([]);
  });

  it('commits an effect assignment in a return expression exactly once', () => {
    const app = mount('return count = 1;', undefined, true);
    expect(app.run()).toBe(1);
    expect(app.commits).toEqual([1]);
    expect(app.button.textContent).toBe('1');
    app.run();
    expect(app.commits).toEqual([1]);
  });

  it('does not mask an exception from an effect finalizer', () => {
    const app = mount('try { throw new Error("original"); } finally { count = 1; }', undefined, true);
    expect(app.run).toThrow('original');
    expect(app.commits).toEqual([]);
  });

  it.each([false, true])('preserves setters and their hidden writes (effect=%s)', effect => {
    const app = mount('box.value = 1;', `let count = 0;
      const box = { get value() { onGet(); throw new Error('getter'); }, set value(v) { count = v; } };`, effect);
    app.run();
    expect(app.getters()).toBe(0);
    expect(app.commits).toEqual([1]);
    expect(app.button.textContent).toBe('1');
  });

  it('preserves proxy traps and computed-key coercion', () => {
    const app = mount('box[key] = 1;', `let count = 0;
      const key = { toString() { onGet(); return 'value'; } };
      const box = new Proxy({}, {
        get() { throw new Error('unexpected read'); },
        getOwnPropertyDescriptor() { throw new Error('unexpected descriptor'); },
        set(target, key, value) { count = value; return true; }
      });`, true);
    app.run();
    expect(app.getters()).toBe(1);
    expect(app.commits).toEqual([1]);
  });

  it('still suppresses equal writes to proven own data properties', () => {
    const app = mount('box.value = 1;', 'let count = 0; const box = { value: 0 };', true);
    app.run();
    app.run();
    expect(app.commits).toHaveLength(1);
  });

  it.each(['count &&= 1;', 'count ??= 1;', 'box.value &&= 1;', 'box.value ??= 1;'])(
    'does not notify a short-circuited logical assignment: %s', body => {
      const app = mount(body, 'let count = 0; const box = { value: 0 };', true);
      app.run();
      expect(app.commits).toEqual([]);
    },
  );

  it('notifies a taken logical assignment only once across repeated effects', () => {
    const app = mount('count ||= 1;', undefined, true);
    app.run();
    app.run();
    expect(app.commits).toEqual([1]);
  });

  it('does not mask a throwing setter', () => {
    const app = mount('box.value = 1;', `let count = 0;
      const box = { set value(v) { count = v; throw new Error('setter'); } };`, true);
    expect(app.run).toThrow('setter');
    expect(app.commits).toEqual([]);
  });

  it('notifies after async returns and rejections without changing their results', async () => {
    const returned = mount('await Promise.resolve(); return count++;', undefined, false, true);
    await expect(returned.run()).resolves.toBe(0);
    expect(returned.commits.at(-1)).toBe(1);
    const rejected = mount('await Promise.resolve(); count++; throw new Error("rejected");', undefined, false, true);
    await expect(rejected.run()).rejects.toThrow('rejected');
    expect(rejected.commits).toEqual([]);
  });
});

describe('JavaScript emission invariants', () => {
  it.each([
    'const value = ((1 as number) as number);',
    'const value = ((1 satisfies number) as number)!;',
    'const fn = <T>(x: T): T => x; const value = (fn<number>)!(1);',
    'declare const ambient: number; const value = 1;',
    'declare namespace Ambient { const value: number; } const value = 1;',
    'export type * from "types"; const value = 1;',
    'abstract class C { abstract method(): void; abstract field: number; } const value = 1;',
    'class C { method(): number; method() { return 1; } } const value = new C().method();',
    'function f(this: { value: number }) { return this.value; } const value = f.call({ value: 1 });',
  ])('emits executable JavaScript for %s', source => {
    for (const code of [compile(source), compileModules({ './a.ts': source })['./a.ts']!]) {
      expect(new Function('_MD', code.replace(/^import .*;$/m, '') + '\nreturn value;')({})).toBe(1);
    }
  });

  it.each([
    ['namespace Values { export const answer = 42; }', 'TSModuleDeclaration'],
    ['class Box { constructor(public value: number) {} }', 'TSParameterProperty'],
    ['@sealed class Box {}', 'decorators'],
    ['class Box { @logged method() {} }', 'decorators'],
    ['class Box { accessor value = 1; }', 'AccessorProperty'],
  ])('rejects runtime-bearing syntax without silently erasing it: %s', (source, kind) => {
    expect(() => compile(source)).toThrow(kind);
    expect(() => compileModules({ './a.ts': source } )).toThrow(kind);
  });

  it('retains linked comments and authored source maps', () => {
    const source = '/* @license Keep this */\nexport const x = /* @__PURE__ */ make();';
    const linked = compileModulesDetailed({ './a.ts': source });
    for (const code of [compile(source), compileDetailed(source).code,
      compileModules({ './a.ts': source })['./a.ts']!, linked.output['./a.ts']!]) {
      expect(code).toContain('@license Keep this');
      expect(code).toContain('@__PURE__');
    }
    expect(linked.maps['./a.ts']!.sourcesContent).toEqual([source]);
  });
});

describe('lexical scope edge cases', () => {
  it.each([
    'let x = 1; function f(a = x) { let x = 2; return a; }',
    'let x = 1; function f(a = () => x) { var x = 2; return a; }',
    'let x = 1; switch (x) { case 1: let x = 2; }',
  ])('keeps outer reads in their authored scope: %s', source => {
    const { program } = parseEstreeOrThrow(source);
    const analysis = analyzeScope(program);
    expect(analysis.rootScope.getBinding('x')!.references).toHaveLength(1);
  });

  it('gives named class expressions their own binding', () => {
    const { program } = parseEstreeOrThrow('let C = 1; const D = class C { method() { return C; } };');
    const analysis = analyzeScope(program);
    expect(analysis.rootScope.getBinding('C')!.references).toHaveLength(0);
    const inner = analysis.rootScope.children.find(s => s.block.type === 'ClassExpression')!;
    expect(inner.bindings.get('C')!.references).toHaveLength(1);
  });

  it('contains static-block var declarations and preserves var binding identity', () => {
    const { program } = parseEstreeOrThrow('let x = 1; class C { static { var x = 2; x++; } } function f(a) { var a; return a; }');
    const analysis = analyzeScope(program);
    expect(analysis.rootScope.getBinding('x')!.kind).toBe('let');
    expect(analysis.rootScope.getBinding('x')!.references).toHaveLength(0);
    const fn = analysis.rootScope.children.find(s => s.block.type === 'FunctionDeclaration')!;
    expect(fn.bindings.get('a')!.kind).toBe('param');
    expect(fn.bindings.get('a')!.references).toHaveLength(1);
  });

  it('does not attribute ordinary class field names as variable reads', () => {
    const { program } = parseEstreeOrThrow('let x = 1; class C { x = 2; [x] = 3; }');
    const analysis = analyzeScope(program);
    expect(analysis.rootScope.getBinding('x')!.references).toHaveLength(1);
  });

  it.each(['{ a }', '...a'])('keeps var redeclarations of non-evaluating parameters in one binding: %s', parameter => {
    const { program } = parseEstreeOrThrow(`function f(${parameter}) { var a; return a; }`);
    const analysis = analyzeScope(program);
    const fn = analysis.rootScope.children[0]!;
    expect(fn.bindings.get('a')!.kind).toBe('param');
    expect(fn.bindings.get('a')!.references).toHaveLength(1);
  });
});

describe('linked analysis parity', () => {
  it('shares external reactive import preparation with standalone compilation', () => {
    const source = `import { location } from 'portable-router';
      export function App() { const section = location.section; return <p>{section}</p>; }`;
    const options = { externalReactiveSources: [{
      module: 'portable-router', source: 'location',
      subscribe: { module: 'portable-router/memoized-dom', export: 'subscribeLocation' },
    }] };
    const linked = compileModulesDetailed({ './a.tsx': source }, options);
    expect(linked.output['./a.tsx']).toBe(compile(source, { ...options, moduleId: './a.tsx' }));
    expect(linked.metadata['./a.tsx']!.readers['./a.tsx#location']).toEqual(['App']);
  });

  it('reports the same conditional-region reader routes that it emits', () => {
    const result = compileModulesDetailed({ './a.tsx': `let ok = true;
      export function App() { return <><p if={ok}>yes</p><p else>no</p>
        <button onClick={() => ok = !ok}>toggle</button></>; }` });
    let readers: unknown;
    execute(result.output['./a.tsx']!, { installAccessTable(table: { readers: unknown }) { readers = table.readers; } });
    expect(result.metadata['./a.tsx']!.readers).toEqual(readers);
    expect(result.metadata['./a.tsx']!.readers['./a.tsx#ok']).toContain('App/when0');
  });
});
