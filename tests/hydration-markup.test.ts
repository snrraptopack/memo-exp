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
  HydrationMismatchError,
  type MountedApplication,
} from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { renderToString } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const SOURCE = `
export function App() {
  let count = 42;
  return (
    <div class="shell" data-kind="app">
      <header>
        <h1>Static title</h1>
        <p class="subtitle">Count is {count}</p>
      </header>
      <section>
        <ul class="items">
          <li>first</li>
          <li>second</li>
        </ul>
        <img src="logo.png" alt="logo" />
      </section>
    </div>
  );
}
`;

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
const output = join(outDir, 'hydration-markup.compiled.ts');
const code = compile(SOURCE, { runtimePath: '@memoized-dom/runtime' });
writeFileSync(output, code);

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
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

describe('static markup emission', () => {
  it('compiles a static subtree into one materializeMarkup call', () => {
    expect(code).toContain('materializeMarkup');
    expect(code).toMatch(/_HTML_\w*\s*=\s*"<div/);
    expect(code).not.toContain("createElement('header')");
    // Dynamic text slot keeps a placeholder node for the seed write.
    expect(code).toMatch(/setTextData\(\w+, "Count is "/);
  });
});

describe('hydration over markup subtrees', () => {
  it('hydrates markup SSR without constructing DOM', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const ssrHtml = renderToString(app.App, { markers: true });
    expect(ssrHtml).toContain('<h1>Static title</h1>');
    expect(ssrHtml).toContain('Count is 42');
    expect(ssrHtml).toContain('<li>first</li>');
    expect(ssrHtml).toContain('src="logo.png"');

    const host = serverHost(ssrHtml);
    const createElement = vi.spyOn(document, 'createElement');
    const createTextNode = vi.spyOn(document, 'createTextNode');

    mounted = mount('root', app.App);

    expect(createElement).not.toHaveBeenCalled();
    expect(createTextNode).not.toHaveBeenCalled();
    expect(getActiveEnvironment().mode).toBe('client-create');

    expect(host.querySelector('h1')!.textContent).toBe('Static title');
    expect(host.querySelector('.subtitle')!.textContent).toBe('Count is 42');
    expect(host.querySelectorAll('li').length).toBe(2);
    const img = host.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('logo');
  });

  it('detects mismatched tags inside markup subtrees and recovers', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const ssrHtml = renderToString(app.App, { markers: true });
    // Corrupt a tag deep inside the markup subtree.
    const corrupted = ssrHtml.replace('<h1>', '<h3>').replace('</h1>', '</h3>');
    const host = serverHost(corrupted);

    let hydrationError: unknown;
    mounted = mount('root', app.App, {
      onHydrateError: (error) => {
        hydrationError = error;
      },
    });

    // The markup claim validates the same nodeType/tag/namespace contract
    // as imperative factory claims — the mismatch surfaces through the
    // documented recovery path, then a fresh mount rebuilds correct DOM.
    expect(hydrationError).toBeInstanceOf(HydrationMismatchError);
    expect(host.querySelector('h1')!.textContent).toBe('Static title');
  });

  it('detects truncated server markup (missing tail node) and recovers', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const ssrHtml = renderToString(app.App, { markers: true });
    const truncated = ssrHtml.replace(/<img[^>]*>/, '');
    const host = serverHost(truncated);

    let hydrationError: unknown;
    mounted = mount('root', app.App, {
      onHydrateError: (error) => {
        hydrationError = error;
      },
    });

    expect(hydrationError).toBeInstanceOf(HydrationMismatchError);
    expect(host.querySelector('img')).not.toBeNull();
  });
});

describe('client-create materialization', () => {
  it('builds the subtree via template clone without hydration markers', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);

    mounted = mount('root', app.App);
    const shell = host.querySelector('.shell')!;
    expect(shell.getAttribute('data-kind')).toBe('app');
    expect(host.querySelector('p')!.textContent).toBe('Count is 42');
    expect(host.querySelectorAll('li').length).toBe(2);
  });
});
