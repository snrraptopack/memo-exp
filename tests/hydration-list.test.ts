import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import { renderToString } from '@memoized-dom/server';
import {
  registerRootFactory,
  resetScheduler,
  setScheduler,
  type MountedApplication,
} from '@memoized-dom/runtime';
import {
  hydrate,
  HydrationMismatchError,
} from '@memoized-dom/runtime/hydrate';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'hydration-list.compiled.ts');

const SOURCE = `
let items = [
  { id: 1, label: 'one' },
  { id: 2, label: 'two' },
];
export function resetItems() {
  items = [
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
  ];
}
export function resetEmpty() {
  items = [];
}
function Row(item) {
  return <li onClick={() => { item.label = item.label + '!'; }}>{item.label}</li>;
}
export function App() {
  return <section>
    <button class="fill" onClick={() => { items = [
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]; }}>fill</button>
    <button class="reverse" onClick={() => { items = [items[1], items[0]]; }}>reverse</button>
    <ul>{items.map((item) => <Row key={item.id} item={item} />)}</ul>
  </section>;
}
`;

interface CompiledListApp {
  App(id: string, parent: null): Node;
  resetItems(): void;
  resetEmpty(): void;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

async function importCompiled(): Promise<CompiledListApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

function serverHost(firstKey = 'n:1', secondKey = 'n:2'): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML =
    '<!--mmd:r:App--><section>' +
    '<button class="fill">fill</button>' +
    '<button class="reverse">reverse</button><ul>' +
    '<!--mmd:l:App/items-->' +
    `<!--mmd:w:App/items:${firstKey}--><li>one</li>` +
    `<!--mmd:w:App/items:${secondKey}--><li>two</li>` +
    '<!--/mmd--></ul></section><!--/mmd-->';
  document.body.appendChild(host);
  return host;
}

function renderServerHost(app: CompiledListApp): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = renderToString(app.App, { markers: true });
  document.body.appendChild(host);
  return host;
}

let mounted: MountedApplication | undefined;

beforeEach(() => {
  document.body.replaceChildren();
  setScheduler((run) => run());
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetScheduler();
  vi.restoreAllMocks();
});

describe('Phase 3 keyed-list hydrate integration', () => {
  it('adopts keyed rows without creation or relocation and preserves updates', async () => {
    const app = await importCompiled();
    app.resetItems();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = renderServerHost(app);
    const list = host.querySelector('ul')!;
    const [first, second] = [...host.querySelectorAll('li')];
    const createElement = vi.spyOn(document, 'createElement');
    const createTextNode = vi.spyOn(document, 'createTextNode');
    const createComment = vi.spyOn(document, 'createComment');
    const createFragment = vi.spyOn(document, 'createDocumentFragment');
    const insertBefore = vi.spyOn(list, 'insertBefore');

    mounted = hydrate('root', app.App);

    expect([...host.querySelectorAll('li')]).toEqual([first, second]);
    expect(createElement).not.toHaveBeenCalled();
    expect(createTextNode).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
    expect(createFragment).not.toHaveBeenCalled();
    expect(insertBefore).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('.reverse')!.click();
    expect([...host.querySelectorAll('li')]).toEqual([second, first]);

    first!.click();
    expect(first!.textContent).toBe('one!');
  });

  it('finishes empty-list adoption before a later client insertion', async () => {
    const app = await importCompiled();
    app.resetEmpty();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = renderServerHost(app);

    mounted = hydrate('root', app.App);
    expect(host.querySelectorAll('li')).toHaveLength(0);

    host.querySelector<HTMLButtonElement>('.fill')!.click();
    expect([...host.querySelectorAll('li')].map((row) => row.textContent))
      .toEqual(['one', 'two']);
  });

  it('rejects a client row key missing from the server marker stream', async () => {
    const app = await importCompiled();
    app.resetItems();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    serverHost('n:9');

    let thrown: unknown;
    try {
      hydrate('root', app.App);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HydrationMismatchError);
    expect((thrown as Error).message).toContain(
      'no matching marker in the server stream',
    );
  });

  it('rejects server rows whose markers are out of client key order', async () => {
    const app = await importCompiled();
    app.resetItems();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    serverHost('n:2', 'n:1');

    expect(() => hydrate('root', app.App)).toThrow(
      'in client key order',
    );
  });
});
