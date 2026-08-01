/**
 * R44 - compiler-native DOM refs.
 *
 * Ref sinks are lowered to callbacks at the authoring site. The same adapter
 * supports direct hosts, component forwarding, arrays, spreads, branches, and
 * rows without introducing runtime JSX or a public ref wrapper/key API.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';
import { mountRef } from '@memoized-dom/runtime';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const SOURCE = `
  globalThis.__r44Events = [];
  export function getEvents() {
    return globalThis.__r44Events;
  }
  function record(value) {
    globalThis.__r44Events.push(value);
  }
  export let moduleNode;
  function namedSetup(node) {
    record("mount:named-callback:" + node.id);
    return () => record("cleanup:named-callback:" + node.id);
  }

  function logRef(name) {
    return node => {
      record("mount:" + name + ":" + node.id);
      return () => record("cleanup:" + name + ":" + node.id);
    };
  }

  function Input({ ref: inputRef, ...rest }) {
    return <input ref={inputRef} {...rest} />;
  }

  function Field({ inputRef, ...rest }) {
    return <input ref={inputRef} {...rest} />;
  }

  function DualInput({ ref: forwardedRef, inputRef, ...rest }) {
    return <input ref={[forwardedRef, inputRef]} {...rest} />;
  }

  function ForwardAll({ id, ...rest }) {
    return <input id={id} {...rest} />;
  }

  function RefRow({ row }) {
    return (
      <li id={"component-row-" + row.id} ref={logRef("component-row-" + row.id)}>
        {row.id}
      </li>
    );
  }

  export function App() {
    let direct;
    let forwarded;
    let named;
    let restForwarded;
    let dualNamed;
    const holder = {};
    let show = true;
    let rows = [{ id: 1 }, { id: 2 }];

    return <main>
      <div id="direct" ref={direct}>direct</div>
      <aside id="module" ref={moduleNode}>module</aside>
      <div id="member" ref={holder.node}>member</div>
      <nav id="named-callback" ref={namedSetup}>named callback</nav>
      <div id="inline-callback" ref={node => {
        record("mount:inline:" + node.id);
        return () => record("cleanup:inline:" + node.id);
      }}>inline callback</div>
      <div
        id="multiple"
        ref={[holder.multi, logRef("first"), logRef("second")]}
      />
      <Input id="forwarded" ref={forwarded} />
      <Field id="named" inputRef={named} />
      <DualInput id="dual" inputRef={dualNamed} />
      <ForwardAll id="rest" ref={restForwarded} />
      <div {...{ id: "spread", ref: logRef("spread") }} />
      <button id="check" onClick={() => record(
        [direct, holder.node, forwarded, named, restForwarded, dualNamed]
          .map(node => node?.id)
          .join(",")
      )}>check</button>
      <button id="toggle" onClick={() => show = !show}>toggle</button>
      {show ? <section id="branch" ref={logRef("branch")}>branch</section> : null}
      <button id="remove" onClick={() => rows.pop()}>remove</button>
      <ul>{rows.map(row => (
        <li key={row.id} id={"row-" + row.id} ref={logRef("row-" + row.id)}>
          {row.id}
        </li>
      ))}</ul>
      <ol>{rows.map(row => (
        <RefRow key={row.id} row={row} />
      ))}</ol>
    </main>;
  }
`;

function importFixture(specifier: string): Promise<any> {
  return import(specifier);
}

describe('R44 - DOM refs', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r44-dom-refs.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('mounts arrays in order, tears down in reverse, and rolls back failures', () => {
    const node = document.createElement('div');
    const order: string[] = [];
    const dispose = mountRef(node, [
      () => {
        order.push('mount:a');
        return () => order.push('cleanup:a');
      },
      () => {
        order.push('mount:b');
        return () => order.push('cleanup:b');
      },
    ]);
    expect(order).toEqual(['mount:a', 'mount:b']);
    dispose();
    dispose();
    expect(order).toEqual([
      'mount:a',
      'mount:b',
      'cleanup:b',
      'cleanup:a',
    ]);

    expect(() =>
      mountRef(node, [
        () => {
          order.push('mount:rollback');
          return () => order.push('cleanup:rollback');
        },
        () => {
          throw new Error('setup failed');
        },
      ]),
    ).toThrow('setup failed');
    expect(order.at(-1)).toBe('cleanup:rollback');
  });

  it('lowers assignable sinks and carries ref metadata across modules', () => {
    const code = compile(SOURCE);
    expect(code).toContain('.mountRef(');
    expect(code).toMatch(/direct = _refNode\d*/);
    expect(code).toMatch(/if \(direct === _refNode\d*\)/);
    expect(code).toMatch(
      /function RefRow\(row, _id\d*(?:, _owner\d*)?\)/,
    );
    expect(code).toMatch(/dispose:\s*\(\) =>/);
    expect(code).not.toContain('createRefKey');

    const output = compileModules({
      './Input.tsx': `
        export function Input({ inputRef, ...rest }) {
          return <input ref={inputRef} {...rest} />;
        }
      `,
      './App.tsx': `
        import { Input } from './Input';
        export function App() {
          let input;
          return <Input id="linked" inputRef={input} />;
        }
      `,
    });
    expect(output['./App.tsx']).toMatch(/input = _refNode\d*/);
    expect(output['./Input.tsx']).toContain('.mountRef(');
  });

  it('assigns direct/member refs and forwards through explicit and rest props', async () => {
    const mod = await importFixture('./fixtures/out/r44-dom-refs.compiled.ts');
    document.body.appendChild(mod.App('App', null));
    const check = document.querySelector<HTMLButtonElement>('#check')!;
    check.click();
    expect(mod.getEvents().at(-1)).toBe(
      'direct,member,forwarded,named,rest,dual',
    );
    expect(mod.moduleNode).toBe(document.querySelector('#module'));
    expect(document.querySelector('#spread')!.hasAttribute('ref')).toBe(false);
    check.click();
    expect(
      mod
        .getEvents()
        .filter((event: string) => event === 'mount:spread:spread'),
    ).toHaveLength(1);

    unregister('App');
    expect(mod.moduleNode).toBeUndefined();
    check.click();
    expect(mod.getEvents().at(-1)).toBe(',,,,,');
    expect(mod.getEvents()).toContain('cleanup:spread:spread');
    expect(
      mod
        .getEvents()
        .filter((event: string) => event.endsWith(':multiple')),
    ).toEqual([
      'mount:first:multiple',
      'mount:second:multiple',
      'cleanup:second:multiple',
      'cleanup:first:multiple',
    ]);
  });

  it('cleans refs immediately when conditional branches and keyed rows leave', async () => {
    const mod = await importFixture('./fixtures/out/r44-dom-refs.compiled.ts');
    document.body.appendChild(mod.App('App', null));
    mod.getEvents().length = 0;

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(document.querySelector('#branch')).toBeNull();
    expect(mod.getEvents()).toContain('cleanup:branch:branch');

    mod.getEvents().length = 0;
    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect(document.querySelector('#row-2')).toBeNull();
    expect(mod.getEvents()).toContain('cleanup:row-2:row-2');
    expect(mod.getEvents()).toContain(
      'cleanup:component-row-2:component-row-2',
    );
    expect(mod.getEvents()).not.toContain('cleanup:row-1:row-1');
  });
});
