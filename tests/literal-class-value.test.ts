import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';
import { mount, registerRootFactory, type MountedApplication } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { renderToString } from '@memoized-dom/server';

let mounted: MountedApplication | undefined;
beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out');
  mkdirSync(directory, { recursive: true });
  for (const kind of ['inline', 'component', 'svg']) {
    const host = kind === 'svg' ? 'g' : 'li';
    const element = `<${host} class={state.primary ? ' first ' : state.secondary ? '\\tsecond\\n' : ' '}>value</${host}>`;
    const source = `
      function Row({ state }) { return ${element}; }
      export function App({ state }) {
        return ${kind === 'svg' ? '<svg>' : '<ul>'}{[1].map(id => ${kind === 'component'
          ? '<Row key={id} state={state} />' : element.replace('class=', 'key={id} class=')})}${kind === 'svg' ? '</svg>' : '</ul>'};
      }
      export function HydratedApp() {
        let active = false;
        return <section><button onClick={() => { active = !active; }}>toggle</button>
          <ul>{[1].map(id => <li key={id} class={active ? ' active ' : ' '}>value</li>)}</ul>
        </section>;
      }
      export function Fallback({ state }) {
        return ${kind === 'svg' ? '<svg><g class={state.primary ? \' first \' : state.value} /></svg>'
          : '<div className={state.primary ? \' first \' : state.value} />'};
      }
    `;
    const output = compile(source);
    // Unknown class values in Fallback keep their normalizer.
    expect(output).toContain('.classValue(');
    writeFileSync(join(directory, `literal-class-${kind}.compiled.ts`), output);
  }
});
beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  setScheduler(run => run());
  document.body.replaceChildren();
});
afterEach(() => {
  mounted?.unmount(); mounted = undefined;
  vi.restoreAllMocks(); resetScheduler();
});

it('omits normalization only when every result branch is a string literal', () => {
  const literal = compile(`export function App({ state }) {
    return <div class={state.flag ? ' a ' : state.other ? ' b ' : ' '} />;
  }`);
  expect(literal).not.toContain('.classValue(');
  for (const expression of ['state.flag ? "a" : state.value', 'state.flag && "a"', 'state.value', 'state.flag ? "a" : ["b"]']) {
    expect(compile(`export function App({ state }) { return <div class={${expression}} />; }`)).toContain('.classValue(');
  }
});

for (const kind of ['inline', 'component', 'svg']) describe(`${kind} literal classes`, () => {
  async function create(state: object, name = 'App') {
    const specifier = `./fixtures/out/literal-class-${kind}.compiled.ts`;
    const module = await import(specifier);
    document.body.append(module[name](name, null, [{ state }]));
    return { node: document.querySelector(kind === 'svg' ? 'g' : name === 'Fallback' ? 'div' : 'li')!,
      render: () => _internals().registry.get(name)!.render() };
  }
  it('keeps conditional getter order, whitespace normalization, identity and guarded writes', async () => {
    const reads: string[] = [];
    let primary = true, secondary = true, throwing = false;
    const app = await create({ get primary() { reads.push('primary'); if (throwing) throw new Error('condition'); return primary; },
      get secondary() { reads.push('secondary'); return secondary; } });
    expect(app.node.getAttribute('class')).toBe('first');
    expect(reads).toEqual(['primary']);
    const observer = new MutationObserver(() => {});
    observer.observe(app.node, { attributes: true }); reads.length = 0;
    app.render();
    expect(reads).toEqual(['primary']); expect(observer.takeRecords()).toHaveLength(0);
    primary = false; reads.length = 0; app.render();
    expect(reads).toEqual(['primary', 'secondary']); expect(app.node.getAttribute('class')).toBe('second');
    secondary = false; app.render();
    expect(app.node.getAttribute('class')).toBe(kind === 'svg' ? null : '');
    throwing = true; expect(app.render).toThrow('condition');
    throwing = false; primary = true; app.render();
    expect(app.node.getAttribute('class')).toBe('first');
    expect(document.querySelector(kind === 'svg' ? 'g' : 'li')).toBe(app.node);
    observer.disconnect();
  });
  it('keeps normalization and mutable object/array replay for unknown branches', async () => {
    const classes = { active: true };
    const state = { primary: false, value: ['  nested ', classes] as unknown };
    const app = await create(state, 'Fallback');
    expect(app.node.getAttribute('class')).toBe('nested active');
    classes.active = false; app.render(); expect(app.node.getAttribute('class')).toBe('nested');
    state.value = '  spaced  '; app.render(); expect(app.node.getAttribute('class')).toBe('spaced');
    state.primary = true; app.render(); expect(app.node.getAttribute('class')).toBe('first');
  });
});

it('adopts server rows and updates literal classes without replacing nodes', async () => {
  const specifier = './fixtures/out/literal-class-inline.compiled.ts';
  const { HydratedApp } = await import(specifier);
  registerRootFactory(HydratedApp, { id: 'HydratedApp', create: () => HydratedApp('HydratedApp', null) });
  const host = document.createElement('div'); host.id = 'root';
  host.innerHTML = renderToString(HydratedApp, { markers: true }); document.body.append(host);
  const row = host.querySelector('li')!;
  const create = vi.spyOn(document, 'createElement');
  mounted = mount('root', HydratedApp);
  expect(create).not.toHaveBeenCalled(); expect(host.querySelector('li')).toBe(row);
  host.querySelector('button')!.click(); expect(row.className).toBe('active');
  host.querySelector('button')!.click(); expect(row.className).toBe('');
  expect(host.querySelector('li')).toBe(row);
});
