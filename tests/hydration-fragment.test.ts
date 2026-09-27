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
  mount,
  resetScheduler,
  setScheduler,
  type MountedApplication,
} from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'hydration-fragment.compiled.ts');

const SOURCE = `
let count = 0;
export function increment() { count++; }
export function App() {
  return <>
    <header><h1>Header</h1></header>
    <main>
      <button onClick={() => { count++; }}>{count}</button>
    </main>
    <footer><p>Footer</p></footer>
  </>;
}
`;

interface CompiledFragmentApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

async function importCompiled(): Promise<CompiledFragmentApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

function renderServerHost(app: CompiledFragmentApp): HTMLElement {
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

describe('Phase 3 fragment and multi-root hydrate integration', () => {
  it('adopts top-level fragment siblings without allocation or reparenting', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = renderServerHost(app);
    const header = host.querySelector('header')!;
    const main = host.querySelector('main')!;
    const footer = host.querySelector('footer')!;
    const button = host.querySelector('button')!;

    const createElement = vi.spyOn(document, 'createElement');
    const createTextNode = vi.spyOn(document, 'createTextNode');
    const createComment = vi.spyOn(document, 'createComment');

    mounted = mount('root', app.App);

    expect(mounted.nodes).toEqual([header, main, footer]);
    expect(host.querySelector('header')).toBe(header);
    expect(host.querySelector('main')).toBe(main);
    expect(host.querySelector('footer')).toBe(footer);

    expect(createElement).not.toHaveBeenCalled();
    expect(createTextNode).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();

    button.click();
    expect(button.textContent).toBe('1');
  });

  it('unmounts every top-level fragment sibling on application unmount', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = renderServerHost(app);

    mounted = mount('root', app.App);
    expect(host.children.length).toBe(3);

    mounted.unmount();
    expect(host.innerHTML).toBe('');
    mounted = undefined;
  });

  it('recovers a fragment root when a server sibling tag is skewed', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML =
      '<!--mmd:r:App-->' +
      '<header><h1>Header</h1></header>' +
      '<article><button>0</button></article>' +
      '<footer><p>Footer</p></footer>' +
      '<!--/mmd-->';
    document.body.appendChild(host);

    mounted = mount('root', app.App);
    expect(host.querySelector('main')).not.toBeNull();
    expect(host.querySelector('article')).toBeNull();
  });
});
