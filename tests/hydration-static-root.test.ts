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
import {
  getActiveEnvironment,
  mount,
  registerRootFactory,
  resetScheduler,
  setScheduler,
  type MountedApplication,
} from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'hydration-static.compiled.ts');

const SOURCE = `
export function App() {
  let clicks = 0;
  return (
    <section>
      <button onClick={() => { clicks++; }}>{clicks}</button>
      <h1>Title</h1>
    </section>
  );
}
`;

interface CompiledStaticApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

async function importCompiled(): Promise<CompiledStaticApp> {
  // Runtime-selected file URL: the generated module does not exist during
  // Vite's import-analysis pass.
  const moduleUrl = pathToFileURL(output).href;
  return import(/* @vite-ignore */ moduleUrl);
}

function serverHost(html: string): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML = html;
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

describe('Phase 3 static-root hydrate integration', () => {
  it('adopts static host/text nodes and keeps events reactive', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = serverHost(
      '<!--mmd:r:App-->' +
        '<section><button>0</button><h1>Title</h1></section>' +
        '<!--/mmd-->',
    );
    const section = host.querySelector('section')!;
    const button = host.querySelector('button')!;
    const heading = host.querySelector('h1')!;
    const createElement = vi.spyOn(document, 'createElement');
    const createTextNode = vi.spyOn(document, 'createTextNode');

    mounted = mount('root', app.App);

    expect(host.querySelector('section')).toBe(section);
    expect(host.querySelector('button')).toBe(button);
    expect(host.querySelector('h1')).toBe(heading);
    expect(createElement).not.toHaveBeenCalled();
    expect(createTextNode).not.toHaveBeenCalled();
    expect(getActiveEnvironment().mode).toBe('client-create');

    button.click();
    expect(button.textContent).toBe('1');
  });

  it('rejects a skewed static tag at the root boundary', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    serverHost(
      '<!--mmd:r:App-->' +
        '<article><button>0</button><h1>Title</h1></article>' +
        '<!--/mmd-->',
    );

    mounted = mount('root', app.App);
    expect(document.querySelector('#root > section')).not.toBeNull();
    expect(document.querySelector('#root > article')).toBeNull();
    expect(getActiveEnvironment().mode).toBe('client-create');
  });

  it('defers structural ranges instead of silently skipping them', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    serverHost(
      '<!--mmd:r:App-->' +
        '<section><button>0</button>' +
        '<!--mmd:g:App/when0--><p>extra</p><!--/mmd-->' +
        '<h1>Title</h1></section>' +
        '<!--/mmd-->',
    );

    mounted = mount('root', app.App);
    expect(document.querySelector('#root > section')).not.toBeNull();
    expect(document.querySelector('#root p')).toBeNull();
  });
});
