/**
 * Regression coverage for the compiler audit fixes:
 *
 *  - list-region suffix allocation collisions
 *  - row-owner commits for rows under expression owners (cond/route regions)
 *  - SSR module-state cell lowering: for-of/for-in targets, member writes,
 *    arbitrary compound operators, destructuring diagnostics, labels
 *  - whitelist-free reactive control-flow derivations (calls replay, helper
 *    summaries fold, non-replayable tests and unsafe calls diagnose)
 *  - switch return-plan forms: trailing break, fallthrough, break-only
 *    branches, dead code after break
 *  - row-derivation substitution scoping (bindings vs. references)
 *  - uppercase JSX-bearing non-function consts diagnostic
 *  - module-state destructuring diagnostics
 *  - dynamic-tag selector evaluated once per pick
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function compileCellModule(body: string): string {
  const output = compileModules(
    { './cell-edge.ts': body },
    { runtimePath: '@memoized-dom/runtime', moduleStateCells: true },
  );
  return output['./cell-edge.ts']!;
}

describe('audit fix: list-region suffix allocation', () => {
  it('allocates unique region suffixes when a repeated source meets a same-named binding', () => {
    const code = compile(`
      export function App() {
        let items = [1, 2];
        let items1 = [3];
        return <main>
          <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
          <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
          <ul>{items1.map(i => <li key={i}>{i}</li>)}</ul>
        </main>;
      }
    `);
    const suffixes = [
      ...code.matchAll(/createListRegion\([\s\S]*?_id \+ "([^"]+)"/g),
    ].map((match) => match[1]);
    expect(suffixes).toHaveLength(3);
    expect(new Set(suffixes).size).toBe(3);
  });

  it('does not collide with cond-region or route suffixes in the same scope', () => {
    const code = compile(`
      export function App() {
        let when0 = [1];
        let items = [2];
        let flag = true;
        return <main>
          {flag ? <p>x</p> : null}
          <ul>{when0.map(i => <li key={i}>{i}</li>)}</ul>
          <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>
        </main>;
      }
    `);
    const suffixes = [
      ...code.matchAll(/createListRegion\([\s\S]*?_id \+ "([^"]+)"/g),
    ].map((match) => match[1]);
    expect(suffixes).toHaveLength(2);
    expect(new Set(suffixes).size).toBe(2);
    // `when0` is taken by the conditional region; the state binding literally
    // named `when0` must escape the reserved pattern rather than collide.
    expect(suffixes).toContain('/when0x');
  });

  it('extracts key from spread attributes with an item-identity fallback', () => {
    const code = compile(`
      function Row(p) { return <p>{p.label}</p>; }
      export function App() {
        let items = [{ id: 'a', label: 'A' }];
        return <main>{items.map((it) => {
          const props = { key: it.id, p: it };
          return <Row {...props} />;
        })}</main>;
      }
    `);
    // The merged key may be nullish; the fallback keeps item identity.
    expect(code).toMatch(/\(\{ \.\.\.\{ key: it\.id, p: it \} \}\)\.key \?\? _keyItem/);
  });
});

describe('audit fix: switch return-plan forms', () => {
  it('accepts a dead trailing break after a case return', () => {
    const code = compile(`
      export function App() {
        let mode = 'a';
        switch (mode) {
          case 'a':
            return <p>A</p>;
            break;
          default:
            return <p>Z</p>;
        }
      }
    `);
    expect(code).toContain('createCondRegion');
  });

  it('collapses empty fallthrough cases into the next branch', () => {
    const code = compile(`
      export function App() {
        let mode = 'b';
        switch (mode) {
          case 'a':
            return <p>A</p>;
          case 'b':
          case 'c':
            return <p>BC</p>;
          default:
            return <p>Z</p>;
        }
      }
    `);
    expect(code).toContain('createCondRegion');
  });

  it('lowers a break-only case to a null branch', () => {
    const code = compile(`
      export function App() {
        let mode = 'skip';
        switch (mode) {
          case 'a':
            return <p>A</p>;
          case 'skip':
            break;
          default:
            return <p>Z</p>;
        }
      }
    `);
    expect(code).toContain('createCondRegion');
  });

  it('still rejects returns outside the switch statement', () => {
    expect(() =>
      compile(`
        export function App() {
          let mode = 'a';
          if (mode === 'x') return <p>early</p>;
          switch (mode) {
            case 'a':
              return <p>A</p>;
            default:
              return <p>Z</p>;
          }
        }
      `),
    ).toThrow();
  });
});

describe('audit fix: module-state cell lowering edge forms', () => {
  it('lowers for-of loop targets through a temp binding and setCell', () => {
    const code = compileCellModule(`
      export let count = 0;
      export function sum(values: number[]) {
        for (count of values) {}
      }
    `);
    const loop = /for \(const (\w+) of values\)/.exec(code);
    expect(loop).not.toBeNull();
    expect(code).toContain(`_MD.setCell(_cell_count, ${loop![1]})`);
    expect(code).not.toMatch(/for \(_MD\.readCell/);
  });

  it('lowers for-in loop targets through a temp binding and setCell', () => {
    const code = compileCellModule(`
      export let key = '';
      export function collect(record: Record<string, number>) {
        for (key in record) {}
      }
    `);
    const loop = /for \(const (\w+) in record\)/.exec(code);
    expect(loop).not.toBeNull();
    expect(code).toContain(`_MD.setCell(_cell_key, ${loop![1]})`);
  });

  it('lowers member writes through updateCell so invalidation commits', () => {
    const code = compileCellModule(`
      export const store = { n: 0 };
      export function bump() {
        store.n += 2;
      }
    `);
    expect(code).toMatch(/_MD\.updateCell\(_cell_store,/);
    expect(code).toMatch(/\.n \+= 2/);
    expect(code).not.toMatch(/_MD\.readCell\(_cell_store\)\.n \+=/);
  });

  it('lowers delete on a state member through updateCell', () => {
    const code = compileCellModule(`
      export const store = { n: 0 };
      export function clear() {
        delete store.n;
      }
    `);
    expect(code).toMatch(/_MD\.updateCell\(_cell_store,/);
    expect(code).toMatch(/delete /);
  });

  it.each(['%=', '**=', '??=', '&&=', '||=', '<<='])(
    'lowers compound operator %s without an operator whitelist',
    (operator) => {
      const code = compileCellModule(`
        export let count = 4;
        export function apply() {
          count ${operator} 2;
        }
      `);
      expect(code).toMatch(/_MD\.updateCell\(_cell_count,/);
      const operatorPattern = new RegExp(
        `\\w+ ${operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 2`,
      );
      expect(code).toMatch(operatorPattern);
    },
  );

  it('rejects destructuring write targets on cell bindings', () => {
    expect(() =>
      compileCellModule(`
        export let count = 0;
        export function apply(source: { count: number }) {
          ({ count } = source);
        }
      `),
    ).toThrow(/destructur/i);
    expect(() =>
      compileCellModule(`
        export let count = 0;
        export function apply(pair: [number, number]) {
          [count] = pair;
        }
      `),
    ).toThrow(/destructur/i);
  });

  it('keeps labels and break targets that share a state name intact', () => {
    const code = compileCellModule(`
      export let count = 0;
      export function run() {
        count: for (;;) {
          break count;
        }
      }
    `);
    expect(code).toContain('count:');
    expect(code).toMatch(/break count;/);
    expect(code).not.toMatch(/break _MD\.readCell/);
  });

  it('rejects value-producing writes with a clear diagnostic', () => {
    expect(() =>
      compileCellModule(`
        export let count = 0;
        export function apply() {
          let next = (count = 2);
          return next;
        }
      `),
    ).toThrow(/cannot produce a value/);
  });

  it.each(['++', '--'])('lowers bare %s updates through updateCell', (operator) => {
    const code = compileCellModule(`
      export let count = 4;
      export function step() { count${operator}; }
    `);
    expect(code).toMatch(/_MD\.updateCell\(_cell_count,/);
    expect(code).toContain(`(${operator}c, c)`);
  });
});

describe('audit fix: whitelist-free reactive control flow', () => {
  it('replays a derivation whose test is a plain state value', () => {
    const code = compile(`
      export function App() {
        let on = false;
        let label = '';
        if (on) label = 'yes';
        else label = 'no';
        return <button onClick={() => on = !on}>{label}</button>;
      }
    `);
    const update = code.indexOf('const _update');
    expect(update).toBeGreaterThan(-1);
    expect(code.indexOf('if (on)', update)).toBeGreaterThan(update);
  });

  it('replays a derivation whose test calls an opaque helper', () => {
    const code = compile(`
      export function App() {
        let step = 0;
        const gate = (v) => v % 2 === 0;
        let label = '';
        if (gate(step)) label = 'even';
        else label = 'odd';
        return <button onClick={() => step++}>{label}</button>;
      }
    `);
    const update = code.indexOf('const _update');
    expect(update).toBeGreaterThan(-1);
    expect(code.indexOf('gate(', update)).toBeGreaterThan(update);
  });

  it('folds summarized helper reads into the replayed derivation sources', () => {
    // `other` must be written somewhere to be reactive state; the fold is what
    // makes `if (probe(src))` a derivation even though `src` never changes.
    const code = compile(`
      let other = 0;
      function probe(v) { return other + v > 1; }
      export function bump() { other = 5; }
      export function App() {
        let src = 1;
        let flag = '';
        if (probe(src)) flag = 'yes';
        else flag = 'no';
        return <main><output>{flag}</output></main>;
      }
    `);
    const update = code.indexOf('const _update');
    expect(code.indexOf('probe(', update)).toBeGreaterThan(update);
  });

  it('rejects control flow whose test is not replayable but reads reactive state', () => {
    expect(() =>
      compile(`
        export function App() {
          let n = 0;
          let label = '';
          if ((n = n + 1) > 0) label = 'x';
          else label = 'y';
          return <p>{label}</p>;
        }
      `),
    ).toThrow(/not replayable/);
  });

  it('rejects a replayed call whose summary performs writes', () => {
    expect(() =>
      compile(`
        let step = 0;
        function bump() { step += 1; return step; }
        export function App() {
          let label = '';
          if (bump() > 0) label = 'a';
          else label = 'b';
          return <p>{label}</p>;
        }
      `),
    ).toThrow(/writes state or cannot be summarized/);
  });

  it('rejects a replayed call whose summary mutates a store member', () => {
    expect(() =>
      compile(`
        const store = { n: 0 };
        function bump() { store.n += 1; return store.n; }
        export function App() {
          let label = '';
          if (bump() > 0) label = 'a';
          else label = 'b';
          return <p>{label}</p>;
        }
      `),
    ).toThrow(/writes state or cannot be summarized/);
  });

  it('folds a component-local closure reads into the derivation', () => {
    const code = compile(`
      export function App() {
        let step = 0;
        const gate = () => step > 0;
        let label = '';
        if (gate()) label = 'on';
        else label = 'off';
        return <button onClick={() => step++}>{label}</button>;
      }
    `);
    const update = code.indexOf('const _update');
    expect(code.indexOf('if (gate())', update)).toBeGreaterThan(update);
  });

  it('folds reads through nested and mutually recursive local closures', () => {
    const nested = compile(`
      export function App() {
        let step = 0;
        const inner = () => step > 1;
        const outer = () => inner();
        let label = '';
        if (outer()) label = 'on';
        else label = 'off';
        return <button onClick={() => step++}>{label}</button>;
      }
    `);
    expect(nested.indexOf('if (outer())', nested.indexOf('const _update')))
      .toBeGreaterThan(-1);
    const mutual = compile(`
      export function App() {
        let step = 0;
        const even = (v) => v === 0 ? true : odd(v - 1);
        const odd = (v) => v === 0 ? false : even(v - 1);
        let label = '';
        if (even(step)) label = 'e';
        else label = 'o';
        return <button onClick={() => step++}>{label}</button>;
      }
    `);
    expect(mutual.indexOf('if (even(step))', mutual.indexOf('const _update')))
      .toBeGreaterThan(-1);
  });

  it.each(['step++', 'store.n++', 'step = 1', 'delete store.n'])(
    'rejects a replayed local closure that writes state: %s',
    (write) => {
      // The closure must also read reactive state — a write-only closure is
      // legitimately one-time setup since the derivation has no sources to
      // re-derive from.
      expect(() =>
        compile(`
          export function App() {
            let step = 0;
            const store = { n: 0 };
            const bump = () => { ${write}; return step > 0; };
            let label = '';
            if (bump()) label = 'on';
            else label = 'off';
            return <button onClick={() => step++}>{label}</button>;
          }
        `),
      ).toThrow(/writes state or cannot be summarized/);
    },
  );

  it('leaves non-reactive imperative control flow as one-time setup', () => {
    const code = compile(`
      function connect() {}
      export function App() {
        let local = false;
        if (local) connect();
        return <p>x</p>;
      }
    `);
    expect(code).toContain('connect()');
  });
});

describe('audit fix: row-derivation substitution scoping', () => {
  const rowProgram = (rowBody: string) => `
    export function App() {
      let items = [{ id: 1, price: 2 }];
      return <ul>{items.map(item => {
        const total = item.price * 2;
        return <li key={item.id}>${rowBody}</li>;
      })}</ul>;
    }
  `;

  it('rejects catch params that shadow a row derivation', () => {
    expect(() =>
      compile(
        rowProgram(
          `<button onClick={() => { try {} catch (total) {} }}>{total}</button>`,
        ),
      ),
    ).toThrow(/shadowed/);
  });

  it('rejects pattern declarators that shadow a row derivation', () => {
    expect(() =>
      compile(
        rowProgram(
          `<button onClick={() => { const { total } = { total: 1 }; }}>{total}</button>`,
        ),
      ),
    ).toThrow(/shadowed/);
  });

  it('rejects reassignment of a row derivation inside the row JSX', () => {
    expect(() =>
      compile(
        rowProgram(
          `<button onClick={() => { total = 5; }}>{total}</button>`,
        ),
      ),
    ).toThrow(/reassigned/);
  });

  it('does not substitute derivation names in label or non-computed key positions', () => {
    const code = compile(
      rowProgram(
        `<button onClick={() => {
          total: for (const x of [1]) { break total; }
          const box = { total: 1 };
        }}>{total}</button>`,
      ),
    );
    expect(code).toContain('total:');
    expect(code).toMatch(/break total;/);
  });

  it('substitutes derivations inside parameter defaults', () => {
    const code = compile(
      rowProgram(
        `<button onClick={(bonus = total + 1) => { }}>{total}</button>`,
      ),
    );
    // The default is an evaluated position: the derivation must be inlined.
    expect(code).toMatch(/bonus = .*price/);
  });
});

describe('audit fix: component and destructuring diagnostics', () => {
  it('reports a clear diagnostic for wrapped uppercase JSX consts', () => {
    expect(() =>
      compile(`
        const C = memo(() => <div />);
        export function App() { return <C />; }
      `),
    ).toThrow(/not a plain function/);
  });

  it('still accepts plain arrow-function components', () => {
    const code = compile(`
      const C = () => <div>ok</div>;
      export function App() { return <C />; }
    `);
    expect(code).toContain('function C(');
  });

  it('rejects written destructured module bindings', () => {
    expect(() =>
      compile(`
        let [a] = [0];
        export function App() {
          return <button onClick={() => { a = 1; }}>{a}</button>;
        }
      `),
    ).toThrow(/destructured module binding/);
  });

  it('rejects destructuring that snapshots reactive module state', () => {
    expect(() =>
      compile(`
        const store = { x: 1 };
        export function bump() { store.x += 1; }
        const { x } = store;
        export function App() { return <p>{x}</p>; }
      `),
    ).toThrow(/snapshots reactive state/);
  });

  it('allows destructuring values with function-boundary reads', () => {
    expect(() =>
      compile(`
        let count = 0;
        const [cb] = [() => count];
        export function App() {
          return <button onClick={() => cb()}>{count}</button>;
        }
      `),
    ).not.toThrow();
  });
});

describe('audit fix: dynamic-tag selector evaluation', () => {
  it('evaluates the selector once per pick, not once per candidate', () => {
    const code = compile(`
      function A() { return <p>A</p>; }
      function B() { return <p>B</p>; }
      export function App() {
        let flip = true;
        const pick = () => flip;
        const View = pick() ? A : B;
        return <View />;
      }
    `);
    const pickStart = code.indexOf('createCondRegion');
    expect(pickStart).toBeGreaterThan(-1);
    // The selector is assigned once to a scratch binding, then compared —
    // `View` appears a single time inside the pick instead of once per
    // candidate.
    const pick = code.slice(pickStart, code.indexOf('[', pickStart));
    expect(pick.match(/\bView\b/g)).toHaveLength(1);
    expect(pick).toContain('_dynamicTagSelector = View');
  });
});

describe('audit check: non-store-shaped const objects', () => {
  it('commits member writes on module const objects through helpers', () => {
    const code = compile(`
      export const cfg = { n: 0 };
      export function bump() { cfg.n++; }
      export function App() {
        return <button onClick={() => bump()}>{cfg.n}</button>;
      }
    `);
    expect(code).toContain('"./component.tsx#cfg.n"');
    expect(code).toContain('commitWrites');
  });

  it('commits member writes on module const objects directly in handlers', () => {
    const code = compile(`
      export const cfg = { n: 0 };
      export function App() {
        return <button onClick={() => cfg.n++}>{cfg.n}</button>;
      }
    `);
    expect(code).toContain('commitWrites');
  });

  it('commits const array mutation so list sources re-sync', () => {
    const code = compile(`
      export const items = ['a'];
      export function App() {
        return <div>
          <button onClick={() => items.push('x')}>add</button>
          <ul>{items.map((it) => <li key={it}>{it}</li>)}</ul>
        </div>;
      }
    `);
    expect(code).toContain('"./component.tsx#items"');
  });

  it('marks the component dirty for member writes on local const objects', () => {
    const code = compile(`
      export function App() {
        const cfg = { n: 0 };
        return <button onClick={() => cfg.n++}>{cfg.n}</button>;
      }
    `);
    expect(code).toContain('markDirty');
  });

  it('rejects reassignment of a const store binding with a clear diagnostic', () => {
    expect(() =>
      compile(`
        export const cfg = { n: 0 };
        export function App() {
          return <button onClick={() => cfg = { n: 9 }}>{cfg.n}</button>;
        }
      `),
    ).toThrow(/cannot reassign store 'cfg'/);
  });
});

const SOURCES: Record<string, string> = {
  'audit-row-owner-cond': `
    let items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    function Row({ item }) {
      return <li id={'row-' + item.id}>
        <button
          id={'del-' + item.id}
          onClick={() => { items = items.filter(x => x !== item); }}
        >del</button>
      </li>;
    }
    export function App() {
      let show = true;
      return <main>
        {show
          ? <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>
          : <p id="hidden">hidden</p>}
      </main>;
    }
  `,
  'audit-switch-return-reactive': `
    export function App() {
      let mode = 'a';
      switch (mode) {
        case 'a':
          return <button id="to-b" onClick={() => mode = 'b'}>A</button>;
          break;
        case 'b':
        case 'c':
          return <main>
            <button id="to-skip" onClick={() => mode = 'skip'}>BC-skip</button>
            <button id="to-d" onClick={() => mode = 'd'}>BC-done</button>
          </main>;
        case 'skip':
          break;
        default:
          return <article id="end">end</article>;
      }
    }
  `,
  'audit-spread-key': `
    function Row(p) { return <p class="srow">{p.label}</p>; }
    export function App() {
      let items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
      return <div>
        <button id="rev" onClick={() => items = [...items].reverse()}>rev</button>
        <button id="recreate" onClick={() => items = items.map(it => ({ ...it }))}>recreate</button>
        <main>{items.map((it) => {
          const props = { key: it.id, p: it };
          return <Row {...props} />;
        })}</main>
      </div>;
    }
  `,
  'audit-spread-no-key': `
    export function App() {
      let items = [{ id: 'a' }, { id: 'b' }];
      const attrs = { class: 'krow' };
      return <div>
        <button id="rev" onClick={() => items = [...items].reverse()}>rev</button>
        <ul>{items.map((it) => <li {...attrs}>{it.id}</li>)}</ul>
      </div>;
    }
  `,
  'audit-cond-assignment-reactive': `
    let other = 0;
    function probe(v) { return other + v > 1; }
    export function App() {
      let src = 1;
      let flag = '';
      if (probe(src)) flag = 'yes';
      else flag = 'no';
      return <main>
        <button id="bump" onClick={() => other = 5}>bump</button>
        <output>{flag}</output>
      </main>;
    }
  `,
};

const MODULE_SOURCES: Record<string, string> = {
  './audit-xmod-state.ts': `
    export let on = false;
    export function toggle() { on = !on; }
  `,
  './audit-xmod-app.tsx': `
    import { on, toggle } from './audit-xmod-state';
    export function App() {
      let label = '';
      if (on) label = 'yes';
      else label = 'no';
      return <main>
        <button id="xmod-toggle" onClick={toggle}>t</button>
        <output>{label}</output>
      </main>;
    }
  `,
};

function importCompiled(name: string): Promise<any> {
  return import(
    /* @vite-ignore */ pathToFileURL(
      join(outDir, `${name}.compiled.ts`),
    ).href
  );
}

describe('audit fixes: compiled runtime behavior', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    for (const [name, source] of Object.entries(SOURCES)) {
      writeFileSync(
        join(outDir, `${name}.compiled.ts`),
        compile(source, { runtimePath: '@memoized-dom/runtime' }),
      );
    }
    const modules = compileModules(MODULE_SOURCES, {
      runtimePath: '@memoized-dom/runtime',
    });
    for (const [key, code] of Object.entries(modules)) {
      const base = key.replace(/^\.\//, '').replace(/\.tsx$/, '.ts');
      writeFileSync(join(outDir, base), code);
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('component rows under an expression owner still invalidate the owning list', async () => {
    const { App } = await importCompiled('audit-row-owner-cond');
    document.body.appendChild(App('App', null));
    expect(document.querySelectorAll('li')).toHaveLength(3);

    document.querySelector<HTMLButtonElement>('#del-2')!.click();
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(document.querySelector('#row-2')).toBeNull();
    expect(document.querySelector('#row-1')).not.toBeNull();
    expect(document.querySelector('#row-3')).not.toBeNull();
  });

  it('switch return plans stay reactive through trailing breaks, fallthrough, and null branches', async () => {
    const { App } = await importCompiled('audit-switch-return-reactive');
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#to-b')?.textContent).toBe('A');
    document.querySelector<HTMLButtonElement>('#to-b')!.click();
    expect(document.querySelector('#to-skip')?.textContent).toBe('BC-skip');

    // Fallthrough: 'b' and 'c' share a branch.
    document.querySelector<HTMLButtonElement>('#to-skip')!.click();
    expect(document.querySelector('#to-skip')).toBeNull();
    expect(document.querySelector('#end')).toBeNull();
  });

  it('conditional assignments replay when helper-summarized reads change', async () => {
    const { App } = await importCompiled('audit-cond-assignment-reactive');
    document.body.appendChild(App('App', null));
    const output = document.querySelector('output')!;
    expect(output.textContent).toBe('no');

    document.querySelector<HTMLButtonElement>('#bump')!.click();
    expect(output.textContent).toBe('yes');
  });

  it('replays plain-boolean conditional assignments on cross-module state', async () => {
    const { App } = await import(
      /* @vite-ignore */ pathToFileURL(join(outDir, 'audit-xmod-app.ts')).href,
    );
    document.body.appendChild(App('App', null));
    const output = document.querySelector('output')!;
    expect(output.textContent).toBe('no');

    document.querySelector<HTMLButtonElement>('#xmod-toggle')!.click();
    expect(output.textContent).toBe('yes');
    document.querySelector<HTMLButtonElement>('#xmod-toggle')!.click();
    expect(output.textContent).toBe('no');
  });

  it('retains rows keyed by a spread attribute across identity changes and reorder', async () => {
    const { App } = await importCompiled('audit-spread-key');
    document.body.appendChild(App('App', null));
    const texts = () =>
      [...document.querySelectorAll('.srow')].map((n) => n.textContent);
    expect(texts()).toEqual(['A', 'B']);
    const first = document.querySelector('.srow')!;

    // Recreated items have fresh identities — only the spread key retains rows.
    document.querySelector<HTMLButtonElement>('#recreate')!.click();
    expect(texts()).toEqual(['A', 'B']);
    expect(document.querySelector('.srow')).toBe(first);

    document.querySelector<HTMLButtonElement>('#rev')!.click();
    expect(texts()).toEqual(['B', 'A']);
    expect(document.querySelectorAll('.srow')[1]).toBe(first);
  });

  it('falls back to item identity when no spread attribute provides key', async () => {
    const { App } = await importCompiled('audit-spread-no-key');
    document.body.appendChild(App('App', null));
    const texts = () =>
      [...document.querySelectorAll('.krow')].map((n) => n.textContent);
    expect(texts()).toEqual(['a', 'b']);

    document.querySelector<HTMLButtonElement>('#rev')!.click();
    expect(texts()).toEqual(['b', 'a']);
  });
});
