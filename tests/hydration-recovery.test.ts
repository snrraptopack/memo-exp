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
const output = join(outDir, 'hydration-recovery.compiled.ts');

const SOURCE = `
let count = 0;
let user = 'Ada';
export function resetState() { count = 0; user = 'Ada'; }
export function setUser(name) { user = name; }
export function App() {
  return (
    <section>
      <h1>{user}</h1>
      <button onClick={() => { count++; }}>{count}</button>
    </section>
  );
}
`;

interface CompiledApp {
  App(id: string, parent: null): Node;
  resetState(): void;
  setUser(name: string): void;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
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

describe('Phase 3 mismatch recovery ladder (Level 1 & Level 3)', () => {
  it('Level 1: scalar text mismatch updates on initial render without throwing or node replacement', async () => {
    const app = await importCompiled();
    app.resetState();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML = renderToString(app.App, { markers: true });
    document.body.appendChild(host);

    const section = host.querySelector('section')!;
    const heading = host.querySelector('h1')!;
    const button = host.querySelector('button')!;

    mounted = hydrate('root', app.App);

    expect(host.querySelector('section')).toBe(section);
    expect(host.querySelector('h1')).toBe(heading);
    expect(host.querySelector('button')).toBe(button);
    expect(heading.textContent).toBe('Ada');

    button.click();
    expect(button.textContent).toBe('1');
  });

  it('Level 3: root structural mismatch recovers to clean client mount in recover mode', async () => {
    const app = await importCompiled();
    app.resetState();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML =
      '<!--mmd:r:App-->' +
      '<article><h1>Ada</h1><button>0</button></article>' +
      '<!--/mmd-->';
    document.body.appendChild(host);

    const recoveredErrors: HydrationMismatchError[] = [];
    mounted = hydrate('root', app.App, {
      recover: true,
      onRecover: (err) => recoveredErrors.push(err),
    });

    expect(recoveredErrors).toHaveLength(1);
    expect(recoveredErrors[0]!.message).toContain(
      'expected element <section>, found element <article>',
    );

    // Host now successfully contains client-created <section> and working button
    expect(host.querySelector('section')).not.toBeNull();
    const button = host.querySelector('button')!;
    button.click();
    expect(button.textContent).toBe('1');
  });

  it('Level 3: root structural mismatch throws in default strict mode', async () => {
    const app = await importCompiled();
    app.resetState();
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });

    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML =
      '<!--mmd:r:App-->' +
      '<article><h1>Ada</h1><button>0</button></article>' +
      '<!--/mmd-->';
    document.body.appendChild(host);

    expect(() => hydrate('root', app.App)).toThrowError(
      HydrationMismatchError,
    );
  });
});
