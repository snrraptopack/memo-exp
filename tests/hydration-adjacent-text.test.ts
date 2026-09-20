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
import { renderToString } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'hydration-adjacent-text.compiled.ts');

const SOURCE = `
export function App() {
  let count = 42;
  return (
    <div>
      <h2>Dashboard {count}</h2>
      <p>Prefix {count} middle {count + 1} suffix</p>
      <span>Only static text</span>
    </div>
  );
}
`;

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

async function importCompiled(): Promise<CompiledApp> {
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

describe('Adjacent text node merging in SSR and hydration', () => {
  it('renders SSR string with merged text nodes and hydrates without mismatch', async () => {
    const app = await importCompiled();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const ssrHtml = renderToString(app.App, { markers: true });
    expect(ssrHtml).toContain('<h2>Dashboard 42</h2>');
    expect(ssrHtml).toContain('<p>Prefix 42 middle 43 suffix</p>');
    expect(ssrHtml).toContain('<span>Only static text</span>');

    const host = serverHost(ssrHtml);
    const createElement = vi.spyOn(document, 'createElement');
    const createTextNode = vi.spyOn(document, 'createTextNode');

    mounted = mount('root', app.App);

    expect(createElement).not.toHaveBeenCalled();
    expect(createTextNode).not.toHaveBeenCalled();
    expect(getActiveEnvironment().mode).toBe('client-create');

    const h2 = host.querySelector('h2')!;
    expect(h2.textContent).toBe('Dashboard 42');
    expect(h2.childNodes.length).toBe(1);

    const p = host.querySelector('p')!;
    expect(p.textContent).toBe('Prefix 42 middle 43 suffix');
    expect(p.childNodes.length).toBe(1);
  });
});
