import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import {
  mount,
  registerRootFactory,
  resetScheduler,
  setScheduler,
  type MountedApplication,
} from '@memoized-dom/runtime';
// Deliberately no '@memoized-dom/runtime/hydrate' import: this file verifies
// mount() falls back to a fresh client mount when server markup is present
// but the optional hydration runtime was never installed.

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'hydration-opt-in.compiled.ts');

const SOURCE = `
export function App() {
  let clicks = 0;
  return (
    <section>
      <button onClick={() => { clicks++; }}>{clicks}</button>
    </section>
  );
}
`;

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

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

describe('hydration opt-in fallback', () => {
  it('keeps hydration and the markup parser out of the published client graph', () => {
    const pending = [join(here, '../packages/runtime/dist/index.js')];
    const visited = new Set<string>();
    let source = '';
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const code = readFileSync(file, 'utf8');
      source += code;
      for (const match of code.matchAll(/\b(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
        pending.push(resolve(dirname(file), match[1]!));
      }
    }
    expect(source).not.toContain('application-root marker');
    expect(source).not.toContain('unclaimed server node(s)');
    expect(source).not.toContain('#x22');
  });

  it('warns and mounts fresh when server markup lacks the hydrate entry', async () => {
    const app = await import(/* @vite-ignore */ pathToFileURL(output).href) as CompiledApp;
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML =
      '<!--mmd:r:App--><section><button>0</button></section><!--/mmd-->';
    document.body.appendChild(host);
    const serverButton = host.querySelector('button')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mounted = mount('root', app.App);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('@memoized-dom/runtime/hydrate'),
    );
    const freshButton = host.querySelector('button')!;
    expect(freshButton).not.toBe(serverButton);
    freshButton.click();
    expect(freshButton.textContent).toBe('1');
  });
});
