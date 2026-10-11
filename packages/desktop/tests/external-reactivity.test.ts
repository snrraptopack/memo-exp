import { expect, it } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { buildDesktopEntry } from '../src/dev/build';
import {
  createDesktopApplication,
  runDesktopEntry,
  type DesktopHost,
  type SceneInstance,
  type SceneTransaction,
} from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
let nextLibrary = 0;

/** This library is ordinary JavaScript; none of its code passes through our compiler. */
async function library() {
  const source = `
    // Isolate each fixture's external module instance.
    const identity = ${nextLibrary++};
    export const state = { value: 1 };
    const listeners = new Set();
    let last;
    export function observe(value, listener) {
      if (value !== state) throw new Error('Wrong external value');
      listeners.add(listener);
      last = listener;
      return () => listeners.delete(listener);
    }
    export function set(value) {
      state.value = value;
      for (const listener of listeners) listener();
    }
    export function size() { return listeners.size; }
    export function late() { last?.(); }
  `;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const api = (await import(url)) as {
    set(value: number): void;
    size(): number;
    late(): void;
  };
  return { url, api, source };
}

function recording(nextFrame?: DesktopHost['nextFrame']) {
  const transactions: SceneTransaction[] = [];
  const values = new Map<number, string>();
  let refusal = false;
  const app = createDesktopApplication({
    nextFrame,
    async install() {},
    async commit(transaction) {
      if (refusal) {
        refusal = false;
        throw new Error('external publication refused');
      }
      transactions.push(transaction);
      for (const operation of transaction.operations) {
        if (operation.kind === 'mount' || operation.kind === 'update') {
          for (const write of operation.values) values.set(operation.handle.id, write.value);
        } else if (operation.kind === 'dispose') values.delete(operation.handle.id);
      }
      return { sequence: transaction.sequence };
    },
  });
  return {
    app,
    values,
    transactions,
    refuse() {
      refusal = true;
    },
  };
}

async function component(url: string, subscribed: boolean, moduleProjection = false) {
  const compiled = compileDesktop(
    `
    import {state} from '${url}';
    ${moduleProjection ? 'const doubled = state.value * 2;' : ''}
    export function Counter() {
      ${moduleProjection ? '' : 'const doubled = state.value * 2;'}
      return <p>{doubled}</p>;
    }
  `,
    {
      moduleId: `external-${nextLibrary}.tsx`,
      runtimePath,
      linkedImports: { state: { type: 'value' } },
      externalReactiveSources: subscribed
        ? [{ module: url, source: 'state', subscribe: { module: url, export: 'observe' } }]
        : [],
    },
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
  ) as Promise<{ Counter(): SceneInstance }>;
}

it('subscribes through module projections and recomputes before native readers', async () => {
  const external = await library();
  const { Counter } = await component(external.url, true, true);
  const fixture = recording();
  const root = fixture.app.mount(Counter);

  try {
    await root.ready;
    expect(external.api.size()).toBe(1);
    expect(fixture.values.get(root.handle.id)).toBe('2');

    external.api.set(9);
    await fixture.app.flush();
    expect(fixture.values.get(root.handle.id)).toBe('18');

    await root.dispose();
    // Module derivations belong to the application even after this reader retires.
    expect(external.api.size()).toBe(1);
    await fixture.app.dispose();
    expect(external.api.size()).toBe(0);
  } finally {
    await fixture.app.dispose();
  }
});

it('observes an uncompiled package through a separate state module and barrel', async () => {
  const external = await library();
  const directory = await mkdtemp(resolve(tmpdir(), 'memo-desktop-external-'));
  const packageDirectory = resolve(directory, 'node_modules/ordinary-store');
  const fixture = recording();

  try {
    await mkdir(packageDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(packageDirectory, 'package.json'),
        JSON.stringify({
          name: 'ordinary-store',
          type: 'module',
          exports: './index.js',
        }),
      ),
      writeFile(resolve(packageDirectory, 'index.js'), external.source),
      writeFile(
        resolve(directory, 'state.ts'),
        `
        import {state} from 'ordinary-store';
        export const doubled = state.value * 2;
      `,
      ),
      writeFile(
        resolve(directory, 'barrel.ts'),
        `
        import {doubled as total} from './state';
        export {total};
      `,
      ),
      writeFile(
        resolve(directory, 'App.tsx'),
        `
        import {total} from './barrel';
        export function App() { return <p>{total}</p>; }
      `,
      ),
      writeFile(
        resolve(directory, 'main.ts'),
        `
        import {mount} from '@memoized-dom/runtime';
        import {set, size, late} from 'ordinary-store';
        import {App} from './App';
        export {set, size, late};
        mount('root', App);
      `,
      ),
    ]);
    const code = await buildDesktopEntry(resolve(directory, 'main.ts'), {
      runtimePath,
      externalReactiveSources: [
        {
          module: 'ordinary-store',
          source: 'state',
          subscribe: { module: 'ordinary-store', export: 'observe' },
        },
      ],
    });
    let api!: typeof external.api;
    const roots = await runDesktopEntry(fixture.app, async () => {
      const entry = await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      );
      api = entry;
    });
    const root = roots.get('root')!;
    expect(api.size()).toBe(1);
    expect(fixture.values.get(root.handle.id)).toBe('2');

    // The library callback starts outside the framework's application context.
    api.set(11);
    await fixture.app.flush();
    expect(fixture.values.get(root.handle.id)).toBe('22');

    await fixture.app.dispose();
    expect(api.size()).toBe(0);
    api.late();
  } finally {
    await fixture.app.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

it('replays external projections in the owning core scope and disposes library subscriptions', async () => {
  const external = await library();
  const { Counter } = await component(external.url, true);
  const first = recording();
  const second = recording();
  const a = first.app.mount(Counter);
  const b = second.app.mount(Counter);
  try {
    await Promise.all([a.ready, b.ready]);
    await Promise.all([first.app.flush(), second.app.flush()]);
    expect(external.api.size()).toBe(2);
    // Deliberately invoke outside either application's async context.
    external.api.set(3);
    await Promise.all([first.app.flush(), second.app.flush()]);
    expect(first.values.get(a.handle.id)).toBe('6');
    expect(second.values.get(b.handle.id)).toBe('6');
    await a.dispose();
    expect(external.api.size()).toBe(1);
    external.api.set(4);
    await second.app.flush();
    expect(second.values.get(b.handle.id)).toBe('8');
    await b.dispose();
    expect(external.api.size()).toBe(0);
    external.api.late();
    await Promise.all([first.app.flush(), second.app.flush()]);
  } finally {
    await Promise.all([first.app.dispose(), second.app.dispose()]);
  }
});

it('retains accepted external values when publication is refused and retries the current value', async () => {
  const external = await library();
  const { Counter } = await component(external.url, true);
  const fixture = recording();
  const root = fixture.app.mount(Counter);
  try {
    await root.ready;
    await fixture.app.flush();
    fixture.refuse();
    external.api.set(5);
    const failure = await fixture.app.flush().then(
      () => undefined,
      (error) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(fixture.values.get(root.handle.id)).toBe('2');
    await root.flush();
    expect(fixture.values.get(root.handle.id)).toBe('10');
  } finally {
    await fixture.app.dispose();
  }
});

it('uses the shared volatile capability on visible frames without a browser document', async () => {
  const external = await library();
  const { Counter } = await component(external.url, false);
  const frames: Array<(frame: { visible: boolean }) => void> = [];
  const fixture = recording(() => new Promise((resolve) => frames.push(resolve)));
  const root = fixture.app.mount(Counter);
  try {
    await root.ready;
    expect(frames).toHaveLength(1);
    external.api.set(7);
    frames.shift()!({ visible: false });
    await fixture.app.flush();
    expect(fixture.values.get(root.handle.id)).toBe('2');
    expect(frames).toHaveLength(1);
    frames.shift()!({ visible: true });
    await fixture.app.flush();
    expect(fixture.values.get(root.handle.id)).toBe('14');
    expect(frames).toHaveLength(1);
    await root.dispose();
    frames.shift()!({ visible: true });
    await fixture.app.flush();
    expect(frames).toHaveLength(0);
  } finally {
    await fixture.app.dispose();
  }
});
