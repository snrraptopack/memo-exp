import { describe, expect, it } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { createProcessHost } from '../src/bridge/process';
import {
  createDesktopApplication,
  sceneAttributes,
  type DesktopHost,
  type SceneInstance,
  type SceneTemplate,
  type SceneTransaction,
} from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
let moduleId = 0;

async function compile(source: string, stylesheet?: string): Promise<{ App(): SceneInstance }> {
  const output = compileDesktop(source, {
    moduleId: `jsx-capabilities-${moduleId++}.tsx`,
    runtimePath,
    readStylesheet: stylesheet === undefined ? undefined : () => stylesheet,
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

function recordingHost() {
  const templates: SceneTemplate[] = [];
  const transactions: SceneTransaction[] = [];
  let rejectNext = false;
  const host: DesktopHost = {
    async install(template) {
      templates.push(template);
    },
    async commit(transaction) {
      if (rejectNext) {
        rejectNext = false;
        throw new Error('native refusal');
      }
      transactions.push(transaction);
      return { sequence: transaction.sequence };
    },
  };
  return {
    host,
    templates,
    transactions,
    reject() {
      rejectNext = true;
    },
  };
}

function click(template: SceneTemplate, id: string): number {
  const node = template.nodes.findIndex(
    (node) => node.kind === 'element' && node.attributes?.id === id,
  );
  return template.events.findIndex((event) => event.node === node && event.type === 'click');
}

describe('desktop finite dynamic tags', () => {
  it('switches intrinsic tags through a shared region and retains the enclosing state', async () => {
    const { App } = await compile(`
      export function App() {
        let compact = true;
        let count = 0;
        const Tag = compact ? 'section' : 'article';
        return <main>
          <button id="toggle" onClick={() => compact = !compact}>Toggle</button>
          <button id="count" onClick={() => count++}>Count</button>
          <Tag id="selected">{count}</Tag>
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      const initialChild = recording.transactions[0]!.operations.find(
        (operation) => operation.kind === 'mount' && operation.handle.id !== root.handle.id,
      );
      expect(initialChild?.kind).toBe('mount');
      await root.dispatch(click(template, 'count'));
      expect(
        recording.transactions
          .at(-1)!
          .operations.some(
            (operation) =>
              operation.kind === 'update' && operation.values.some((write) => write.value === '1'),
          ),
      ).toBe(true);
      await root.dispatch(click(template, 'toggle'));
      const replacement = recording.transactions
        .at(-1)!
        .operations.find((operation) => operation.kind === 'mount');
      expect(replacement?.kind).toBe('mount');
      if (replacement?.kind === 'mount') {
        const definition = recording.templates.find(
          (template) => template.id === replacement.template,
        )!;
        expect(
          definition.nodes.some((node) => node.kind === 'element' && node.tag === 'article'),
        ).toBe(true);
        expect(replacement.values.some((write) => write.value === '1')).toBe(true);
      }
    } finally {
      await app.dispose();
    }
  });

  it('supports member-selected component identities and retries a refused switch', async () => {
    const { App } = await compile(`
      function First({ value }) { return <p>First: {value}</p>; }
      function Second({ value }) { return <p>Second: {value}</p>; }
      export function App() {
        let value = 7;
        let registry = { View: First };
        return <main>
          <button id="switch" onClick={() => registry.View = Second}>Switch</button>
          <registry.View value={value} />
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      recording.reject();
      await expect(root.dispatch(click(template, 'switch'))).rejects.toThrow('native refusal');
      expect(recording.transactions).toHaveLength(1);
      await root.flush();
      expect(recording.transactions.at(-1)!.sequence).toBe(2);
      expect(
        recording.transactions
          .at(-1)!
          .operations.some(
            (operation) => operation.kind === 'mount' && operation.template.endsWith('#Second'),
          ),
      ).toBe(true);
    } finally {
      await app.dispose();
    }
  });
});

describe('desktop ordered attribute spreads', () => {
  it('uses the same property transaction for ordinary reactive class and style attributes', async () => {
    const { App } = await compile(`
      export function App() {
        let active = false;
        return <main>
          <button id="toggle" onClick={() => active = !active}>Toggle</button>
          <section class={active ? 'active' : 'idle'} style={{ padding: active ? 12 : 4 }}>Content</section>
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      await root.dispatch(click(template, 'toggle'));
      expect(recording.transactions.at(-1)!.operations).toMatchObject([
        {
          kind: 'properties',
          properties: [
            { attributes: { class: 'active' }, style: [{ property: 'padding', value: '12px' }] },
          ],
        },
      ]);
    } finally {
      await app.dispose();
    }
  });

  it('instrument callbacks authored inside spread expressions', async () => {
    const { App } = await compile(`
      export function App() {
        let count = 0;
        return <button {...{ onClick: () => count++ }}>{count}</button>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      await root.dispatch(0);
      expect(recording.transactions.at(-1)!.operations).toMatchObject([
        { kind: 'update', values: [{ value: '1' }] },
      ]);
    } finally {
      await app.dispose();
    }
  });

  it('binds spread refs after acceptance and reads accepted attributes throughout replacement and disposal', async () => {
    const compiled = (await compile(`
      let element = null;
      let cleanups = 0;
      function accept(node) {
        element = node;
        return () => { element = null; cleanups++; };
      }
      export function snapshot() {
        return { id: element?.id, title: element?.getAttribute('title'), connected: element?.isConnected, cleanups };
      }
      export function App() {
        let props = { id: 'first', title: 'remove', ref: accept };
        return <main>
          <button id="replace" onClick={() => props = { id: 'second', ref: accept }}>Replace</button>
          <section {...props}>Content</section>
        </main>;
      }
    `)) as { App(): SceneInstance; snapshot(): Record<string, unknown> };
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(compiled.App);
      await root.ready;
      await app.flush();
      expect(app.run(compiled.snapshot)).toEqual({
        id: 'first',
        title: 'remove',
        connected: true,
        cleanups: 0,
      });
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      recording.reject();
      await expect(root.dispatch(click(template, 'replace'))).rejects.toThrow('native refusal');
      expect(app.run(compiled.snapshot)).toEqual({
        id: 'first',
        title: 'remove',
        connected: true,
        cleanups: 0,
      });
      await root.flush();
      expect(app.run(compiled.snapshot)).toEqual({
        id: 'second',
        title: null,
        connected: true,
        cleanups: 0,
      });
      await root.dispose();
      expect(app.run(compiled.snapshot).cleanups).toBe(1);
    } finally {
      await app.dispose();
    }
  });

  it('normalizes aliases per spread, copying getters once', () => {
    let reads = 0;
    const first = {
      get className() {
        reads++;
        return 'first';
      },
      class: 'last',
    };
    expect({ ...sceneAttributes(first), ...sceneAttributes({ className: 'override' }) }).toEqual({
      class: 'override',
    });
    expect(reads).toBe(1);
    expect(sceneAttributes(null)).toEqual({});
  });

  it('publishes override order, removals and CSS without remounting the element', async () => {
    const { App } = await compile(`
      export function App() {
        let props = { className: 'old', title: 'remove me', style: { paddingTop: 8 } };
        return <main>
          <button id="replace" onClick={() => props = { class: 'new', style: 'padding: 12px; color: red' }}>Replace</button>
          <section class="before" {...props} id="spread">Content</section>
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const initial = recording.transactions[0]!.operations.find(
        (operation) => operation.kind === 'properties',
      );
      expect(initial).toMatchObject({
        properties: [
          {
            attributes: { class: 'old', title: 'remove me', id: 'spread' },
            style: [{ property: 'padding-top', value: '8px' }],
          },
        ],
      });
      if (initial?.kind !== 'properties') throw new Error('Missing initial properties');
      const propertyNode = initial.properties[0]!.node;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      await root.dispatch(click(template, 'replace'));
      expect(recording.transactions.at(-1)!.operations).toEqual([
        {
          kind: 'properties',
          handle: root.handle,
          properties: [
            {
              node: propertyNode,
              attributes: { class: 'new', id: 'spread' },
              style: 'padding: 12px; color: red',
            },
          ],
        },
      ]);
    } finally {
      await app.dispose();
    }
  });

  it('updates accepted spread handlers and preserves them when native publication fails', async () => {
    const { App } = await compile(`
      export function App() {
        let count = 0;
        const first = () => count += 1;
        const second = () => count += 10;
        let props = { title: 'first', onClick: first };
        return <main>
          <button id="replace" onClick={() => props = { title: 'second', onClick: second }}>Replace</button>
          <button {...props} id="spread">Action</button>
          <p>{count}</p>
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      const propertyMount = recording.transactions[0]!.operations.find(
        (operation) => operation.kind === 'properties',
      );
      if (propertyMount?.kind !== 'properties') throw new Error('Missing spread event properties');
      const actionNode = propertyMount.properties[0]!.node;
      const action = template.events.findIndex(
        (event) => event.node === actionNode && event.type === 'click',
      );
      await root.dispatch(action);
      expect(recording.transactions.at(-1)!.operations).toMatchObject([
        { values: [{ value: '1' }] },
      ]);
      recording.reject();
      await expect(root.dispatch(click(template, 'replace'))).rejects.toThrow('native refusal');
      // The authored bag has changed, but the accepted event still invokes first.
      await root.dispatch(action);
      expect(
        recording.transactions
          .at(-1)!
          .operations.some(
            (operation) =>
              operation.kind === 'update' && operation.values.some((write) => write.value === '2'),
          ),
      ).toBe(true);
      await root.dispatch(action);
      expect(
        recording.transactions
          .at(-1)!
          .operations.some(
            (operation) =>
              operation.kind === 'update' && operation.values.some((write) => write.value === '12'),
          ),
      ).toBe(true);
    } finally {
      await app.dispose();
    }
  });

  it('passes primitive component props through ordered spreads and updates their reader', async () => {
    const { App } = await compile(`
      function Child({ label }) { return <p>{label}</p>; }
      export function App() {
        let props = { label: 'first' };
        return <main>
          <button id="replace" onClick={() => props = { label: 'second' }}>Replace</button>
          <Child label="before" {...props} />
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      await root.dispatch(click(template, 'replace'));
      expect(recording.transactions.at(-1)!.operations).toMatchObject([
        { kind: 'update', values: [{ value: 'second' }] },
      ]);
    } finally {
      await app.dispose();
    }
  });
});

describe('accepted desktop property bindings', () => {
  it('replaces a callback even when native attributes have not changed', async () => {
    const { App } = await compile(`
      export function App() {
        let count = 0;
        let props = { onClick: () => count += 1 };
        return <main>
          <button id="replace" onClick={() => props = { onClick: () => count += 10 }}>Replace</button>
          <button {...props}>Action</button>
          <p>{count}</p>
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      const initial = recording.transactions[0]!.operations.find(
        (operation) => operation.kind === 'properties',
      );
      if (initial?.kind !== 'properties') throw new Error('Missing property binding');
      const action = template.events.findIndex(
        (event) => event.node === initial.properties[0]!.node && event.type === 'click',
      );
      const transactionCount = recording.transactions.length;
      await root.dispatch(click(template, 'replace'));
      expect(recording.transactions).toHaveLength(transactionCount);
      await root.dispatch(action);
      expect(recording.transactions.at(-1)!.operations).toMatchObject([
        { kind: 'update', values: [{ value: '10' }] },
      ]);
    } finally {
      await app.dispose();
    }
  });

  it('keeps an explicit assignable ref stable across property reads', async () => {
    const compiled = (await compile(`
      let element = null;
      export function snapshot() { return element?.id ?? null; }
      export function App() {
        let props = { id: 'first' };
        return <main>
          <button id="replace" onClick={() => props = { id: 'second' }}>Replace</button>
          <section {...props} ref={element}>Content</section>
        </main>;
      }
    `)) as { App(): SceneInstance; snapshot(): string | null };
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(compiled.App);
      await root.ready;
      await app.flush();
      expect(app.run(compiled.snapshot)).toBe('first');
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      await root.dispatch(click(template, 'replace'));
      expect(app.run(compiled.snapshot)).toBe('second');
      await root.dispose();
      expect(app.run(compiled.snapshot)).toBe(null);
    } finally {
      await app.dispose();
    }
  });

  it('rejects unsupported runtime attributes before native publication', async () => {
    const { App } = await compile(`
      export function App() {
        let props = { title: 'valid' };
        return <main>
          <button id="replace" onClick={() => props = { href: '/unsupported' }}>Replace</button>
          <section {...props}>Content</section>
        </main>;
      }
    `);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    try {
      const root = app.mount(App);
      await root.ready;
      const template = recording.templates.find((template) => template.id.endsWith('#App'))!;
      await expect(root.dispatch(click(template, 'replace'))).rejects.toThrow(
        'Desktop attribute href',
      );
      expect(recording.transactions).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });

  it('uses real native property replacement for CSS and controlled input values', async () => {
    const { App } = await compile(
      `
      import './properties.css';
      export function App() {
        let props = { class: 'first', value: 'start', placeholder: 'Write here' };
        return <main>
          <button id="replace" onClick={() => props = { class: 'second', value: 'accepted' }}>Replace</button>
          <input {...props} />
        </main>;
      }
    `,
      '.first { padding: 4px; } .second { padding: 12px; }',
    );
    const executable = resolve(
      import.meta.dirname,
      '../rust/target/debug',
      process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host',
    );
    const host = createProcessHost({ executable });
    const templates: SceneTemplate[] = [];
    const app = createDesktopApplication({
      async install(template) {
        templates.push(template);
        await host.install(template);
      },
      commit: (transaction) => host.commit(transaction),
    });
    try {
      const root = app.mount(App);
      await root.ready;
      const template = templates.find((template) => template.id.endsWith('#App'))!;
      const initial = await host.inspect();
      const input = template.nodes.findIndex(
        (node) => node.kind === 'element' && node.tag === 'input',
      );
      expect(initial.instances[0]!.properties![input]!.attributes).toMatchObject({
        value: 'start',
        placeholder: 'Write here',
      });
      await root.dispatch(click(template, 'replace'));
      const accepted = await host.inspect();
      expect(accepted.instances[0]!.handle).toEqual(initial.instances[0]!.handle);
      expect(accepted.instances[0]!.properties![input]!.attributes).toEqual({
        class: 'second',
        value: 'accepted',
      });
      expect(accepted.instances[0]!.styles![input]!.states[0]!['padding-top']).toBe('12px');
      expect(accepted.instances[0]!.texts[input]).toBe('accepted');
    } finally {
      await app.dispose();
      await host.close();
    }
  });
});
