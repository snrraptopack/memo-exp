import { type FetchStub } from '../../../test-support/helpers';
import '../../../test-support/dom';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { commit, commitWrites, mount, registerRootFactory, resetScheduler, setScheduler } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { render, renderToString, type ServerComponent } from '../src/index';
import { renderWithDom } from '../src/dom';
import { StringDocument } from '../src/string-document';
import { RenderSession } from '../src/session';
import { normalizeHtml } from './parity-harness';

const DIRECTORY = join(import.meta.dirname, 'fixtures', 'out');
let fallbackSequence = 0;
async function variants(name: string, source: string, options: { moduleStateCells?: boolean } = {}) {
  mkdirSync(DIRECTORY, { recursive: true });
  const id = `./writer-${name}.tsx`;
  async function load(ssrWriter: boolean) {
    const code = compileModules({ [id]: source,
      './main.ts': `import {mount} from '@memoized-dom/runtime';import {App} from '${id}';mount('root',App);` }, { ...options, ssrWriter })[id]!;
    const path = join(DIRECTORY, `writer-${name}-${ssrWriter}.ts`);
    writeFileSync(path, code);
    return { code, module: await import(pathToFileURL(path).href) };
  }
  return { baseline: await load(false), writer: await load(true) };
}

const ROWS = `
let rows = [{ id: 1, label: '<hello> & "friends"', active: true },
            { id: 2, label: 'second', active: false }];
function Row(item) {
  return <tr class={item.active ? [' hot ', { active: true }] : ''}>
    <td data-kind="id">{item.id}</td><td>{item.label}</td>
  </tr>;
}
export function App() {
  return <table><tbody>{rows.map(row => <Row item={row} key={row.id} />)}</tbody></table>;
}`;

describe('experimental compiler leaf writer', () => {
  it('matches exact string-tier output, DOM semantics, and hydration', async () => {
    const { baseline, writer } = await variants('rows', ROWS);
    expect(writer.code).toContain('.htmlWriter');
    for (const markers of [false, true]) {
      const html = renderToString(writer.module.App, { markers });
      expect(html).toBe(renderToString(baseline.module.App, { markers }));
      expect(html).toContain('&lt;hello&gt; &amp; "friends"');
      const dom = renderWithDom(writer.module.App, { markers });
      try { expect(normalizeHtml(html)).toBe(normalizeHtml(dom.html)); }
      finally { dom.runtime.dispose(); }
    }
    registerRootFactory(writer.module.App, { id: 'App', create: () => writer.module.App('App', null) });
    const host = document.createElement('div');
    host.innerHTML = renderToString(writer.module.App, { markers: true });
    document.body.appendChild(host);
    const row = host.querySelector('tr');
    const errors: unknown[] = [];
    const mounted = mount(host, writer.module.App, { onHydrateError: error => errors.push(error) });
    try {
      expect(errors).toEqual([]);
      expect(host.querySelector('tr')).toBe(row);
      expect(host.querySelectorAll('td')).toHaveLength(4);
    } finally { mounted.unmount(); host.remove(); }
  });

  it('removes interior node allocations while retaining list markers', async () => {
    const { baseline, writer } = await variants('allocations', ROWS);
    function count(component: ServerComponent) {
      let nodes = 0;
      let retained = 0;
      function visit(node: Node): void {
        retained++;
        for (let child = node.firstChild; child !== null; child = child.nextSibling) visit(child);
      }
      class CountingDocument extends StringDocument {
        override createElement(tag: string): Element { nodes++; return super.createElement(tag); }
        override createTextNode(text: string): Text { nodes++; return super.createTextNode(text); }
      }
      const document = new CountingDocument();
      const html = RenderSession.execute(component, { markers: true }, { mode: 'server-string', document }, session => {
        const root = session.mount();
        visit(root);
        return (root as unknown as { toString(markers: boolean): string }).toString(true);
      });
      return { nodes, retained, html };
    }
    const before = count(baseline.module.App);
    const after = count(writer.module.App);
    expect(after.html).toBe(before.html);
    expect(after.nodes).toBeLessThan(before.nodes);
    expect(after.retained).toBe(before.retained - 8); // two five-node rows → two extents
    expect(after.html).toContain('<!--mmd:w:');
  });

  it('preserves empty text exactly as the existing string tier', async () => {
    const { baseline, writer } = await variants('empty', ROWS.replace("label: 'second'", "label: ''"));
    expect(renderToString(writer.module.App, { markers: true }))
      .toBe(renderToString(baseline.module.App, { markers: true }));
    // Empty server text has no physical browser text node. Record parity
    // with the current hydration recovery instead of hiding that limitation.
    function hydrate(component: ServerComponent) {
      registerRootFactory(component, { id: 'App', create: () => component('App', null) });
      const host = document.createElement('div');
      host.innerHTML = renderToString(component, { markers: true });
      document.body.appendChild(host);
      const errors: string[] = [];
      const mounted = mount(host, component, { onHydrateError: error => errors.push(error.message) });
      mounted.unmount();
      host.remove();
      return errors;
    }
    expect(hydrate(writer.module.App)).toEqual(hydrate(baseline.module.App));
  });

  it('retains slots through data settlement and a keyed row replacement', async () => {
    const source = `
      import { $fetch, Group } from '@memoized-dom/data';
      let rows = [{ id: 1, label: 'before', active: false }];
      function Pending() { return <p>pending</p>; }
      function Row(item) { return <li class={item.active ? 'hot' : ''}>{item.label}</li>; }
      export function App() {
        const result = $fetch('/api/change');
        return <main><ul>{rows.map(row => <Row item={row} key={row.id} />)}</ul>
          <Group pending={Pending}><p>{result.status}</p></Group></main>;
      }
      export function replace() { rows = [{ id: 1, label: '<after>', active: true }]; }
    `;
    const { baseline, writer } = await variants('settled', source);
    expect(writer.code).toContain('.htmlWriter');
    async function resolved(module: typeof writer.module) {
      return render(module.App, { mode: 'resolve', markers: true, fetch: (async () => {
        await Promise.resolve();
        module.replace();
        commitWrites(['./writer-settled.tsx#rows']);
        commit();
        return Response.json({ status: 'done' });
      }) as FetchStub });
    }
    setScheduler(run => run());
    try {
      const before = await resolved(baseline.module);
      const after = await resolved(writer.module);
      expect(after.html).toBe(before.html);
      expect(after.html).toContain('class="hot">&lt;after&gt;');
      expect(after.html).toContain('done');
      expect(after.payload).toEqual(before.payload);
      expect(after.settlement.status).toBe('complete');
    } finally { resetScheduler(); }
  });

  it('serializes stored text without evaluating its getter a second time', async () => {
    const source = `
      let reads = 0;
      let rows = [{ id: 1, get label() { reads++; return 'read-' + reads; } }];
      function Row(item) { return <li>{item.label}</li>; }
      export function App() { return <ul>{rows.map(row => <Row item={row} key={row.id} />)}</ul>; }
      export function count() { return reads; }
    `;
    const { baseline, writer } = await variants('getter', source);
    expect(renderToString(writer.module.App)).toBe(renderToString(baseline.module.App));
    expect(writer.module.count()).toBe(baseline.module.count());
    expect(writer.module.count()).toBe(1);
  });

  it.each(['  card  ', '  a & "b" <c>  ', '   '])('folds a proven literal class with exact parity: %s', async className => {
    const { baseline, writer } = await variants(`static-class-${++fallbackSequence}`, `
      let rows = [{ id: 1, label: '<row>' }];
      function Row(item) { return <li class='${className}' data-kind="row">{item.label}</li>; }
      export function App() { return <ul>{rows.map(row => <Row item={row} key={row.id} />)}</ul>; }
    `);
    expect(writer.code).toContain('.htmlWriter');
    expect(writer.code).not.toContain('.classAttribute(');
    for (const markers of [false, true]) {
      expect(renderToString(writer.module.App, { markers })).toBe(renderToString(baseline.module.App, { markers }));
    }
  });

  it('keeps retained row snapshots isolated across concurrent request cells', async () => {
    const source = `
      import { $fetch, Group } from '@memoized-dom/data';
      let rows = [{ id: 1, label: 'initial' }];
      function Pending() { return <p>pending</p>; }
      function Row(item) { return <li>{item.label}</li>; }
      export function App() {
        const result = $fetch('/api/ready');
        return <main><ul>{rows.map(row => <Row item={row} key={row.id} />)}</ul>
          <Group pending={Pending}><p>{result.status}</p></Group></main>;
      }
      export function replace(label) { rows = [{ id: 1, label }]; }
    `;
    const { baseline, writer } = await variants('cells', source, { moduleStateCells: true });
    expect(writer.code).toContain('.htmlWriter');
    async function pair(module: typeof writer.module) {
      return Promise.all(['request-A', 'request-B'].map(label => render(module.App, {
        mode: 'resolve', markers: true, fetch: (async () => {
          await Promise.resolve();
          await Promise.resolve();
          module.replace(label);
          commitWrites(['./writer-cells.tsx#rows']);
          commit();
          return Response.json({ status: 'done' });
        }) as FetchStub,
      })));
    }
    const before = await pair(baseline.module);
    const after = await pair(writer.module);
    for (const index of [0, 1]) {
      expect(after[index]!.html).toBe(before[index]!.html);
      expect(after[index]!.html).toContain(index === 0 ? 'request-A' : 'request-B');
      expect(after[index]!.html).not.toContain(index === 0 ? 'request-B' : 'request-A');
      expect(after[index]!.payload).toEqual(before[index]!.payload);
    }
  });

  it('preserves imported row cells through concurrent replacement, insertion, and reordering', async () => {
    const sources = {
      './writer-imported/main.ts': `import { mount } from '@memoized-dom/runtime';
        import { App } from './app'; mount('root', App);`,
      './writer-imported/state.ts': `
        export let rows = [{ id: 1, label: 'first', active: false }, { id: 2, label: 'second', active: false }];
        export function replace(label) {
          rows = [{ id: 2, label: label + '-two', active: true },
                  { id: 1, label: label + '-one', active: true },
                  { id: 3, label: label + '-three', active: false }];
        }
      `,
      './writer-imported/row.tsx': `
        export let prefix = 'initial';
        export function setPrefix(next) { prefix = next; }
        export function Row(item) {
          return <li class={item.active ? 'hot' : ''}><b>{prefix}</b><span>{item.label}</span></li>;
        }
      `,
      './writer-imported/app.tsx': `
        import { $fetch, Group } from '@memoized-dom/data';
        import { rows } from './state';
        import { Row } from './row';
        function Pending() { return <p>pending</p>; }
        export function App() {
          const result = $fetch('/api/ready');
          return <main><ul>{rows.map(row => <Row item={row} key={row.id} />)}</ul>
            <Group pending={Pending}><p>{result.status}</p></Group></main>;
        }
      `,
    };
    async function load(ssrWriter: boolean) {
      const output = compileModules(sources, { moduleStateCells: true, ssrWriter });
      const directory = join(DIRECTORY, `writer-imported-${ssrWriter}`);
      mkdirSync(directory, { recursive: true });
      for (const [id, code] of Object.entries(output)) writeFileSync(join(directory, id.slice('./writer-imported/'.length)), code);
      return { code: output['./writer-imported/row.tsx']!,
        app: await import(pathToFileURL(join(directory, 'app.tsx')).href),
        state: await import(pathToFileURL(join(directory, 'state.ts')).href),
        row: await import(pathToFileURL(join(directory, 'row.tsx')).href) };
    }
    const baseline = await load(false);
    const writer = await load(true);
    expect(writer.code).toContain('.htmlWriter');
    async function pair(module: typeof writer) {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let arrived = 0;
      return Promise.all(['import-A', 'import-B'].map(label => render(module.app.App, {
        mode: 'resolve', markers: true, fetch: (async () => {
          if (++arrived === 2) release();
          await gate;
          module.state.replace(label);
          module.row.setPrefix(label);
          commitWrites(['./writer-imported/state.ts#rows', './writer-imported/row.tsx#prefix']);
          commit();
          return Response.json({ status: 'done' });
        }) as FetchStub,
      })));
    }
    const before = await pair(baseline);
    const after = await pair(writer);
    for (const index of [0, 1]) {
      const own = index === 0 ? 'import-A' : 'import-B';
      const other = index === 0 ? 'import-B' : 'import-A';
      expect(after[index]!.html).toBe(before[index]!.html);
      expect(after[index]!.payload).toEqual(before[index]!.payload);
      expect(after[index]!.settlement.status).toBe('complete');
      expect(after[index]!.html).toContain(`<b>${own}</b><span>${own}-three</span>`);
      expect(after[index]!.html).not.toContain(other);
      expect(after[index]!.html.indexOf(`${own}-two`)).toBeLessThan(after[index]!.html.indexOf(`${own}-one`));
      expect(after[index]!.html).toContain('done');
    }
  });

  it.each([
    '<input value={item.label} checked />',
    '<svg><text>{item.label}</text></svg>',
    '<li style={{ color: item.label }}>{item.label}</li>',
    '<li title={item.label}>{item.label}</li>',
    '<li>{item.active ? <b>on</b> : <i>off</i>}</li>',
    '<li onClick={() => { item.active = !item.active; }}>{item.label}</li>',
  ])('falls back for unsupported operations: %s', async jsx => {
    const { baseline, writer } = await variants(`fallback-${++fallbackSequence}`, `
      let rows = [{ id: 1, label: 'red', active: true }];
      function Row(item) { return ${jsx}; }
      export function App() { return <ul>{rows.map(row => <Row item={row} key={row.id} />)}</ul>; }
    `);
    expect(writer.code).not.toContain('.htmlWriter');
    expect(renderToString(writer.module.App, { markers: true }))
      .toBe(renderToString(baseline.module.App, { markers: true }));
  });
});
