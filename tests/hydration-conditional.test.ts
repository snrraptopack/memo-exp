import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import {
  registerRootFactory,
  mount,
  resetScheduler,
  setScheduler,
  type MountedApplication,
} from '@memoized-dom/runtime';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'hydration-conditional.compiled.ts');

const SOURCE = `
let visible = false;
export function setVisible(next: boolean) { visible = next; }
export function App() {
  return (
    <section>
      <button onClick={() => { visible = !visible; }}>toggle</button>
      {visible ? <p class="yes">yes</p> : <p class="no">no</p>}
    </section>
  );
}
`;

interface CompiledConditionalApp {
  App(id: string, parent: null): Node;
  setVisible(next: boolean): void;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

/** Runtime-selected file URL: the generated module skips import analysis. */
async function importCompiled(): Promise<CompiledConditionalApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

function serverHost(branch: string): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  host.innerHTML =
    '<!--mmd:r:App-->' +
    '<section><button>toggle</button>' +
    '<!--mmd:g:App/when0-->' +
    branch +
    '<!--/mmd--></section>' +
    '<!--/mmd-->';
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
});

describe('Phase 3 conditional hydration', () => {
  it('adopts the active branch once and creates later swaps normally', async () => {
    const app = await importCompiled();
    app.setVisible(false);
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = serverHost('<p class="no">no</p>');
    const button = host.querySelector('button')!;
    const serverBranch = host.querySelector('p')!;

    mounted = mount('root', app.App);

    expect(host.querySelector('p')).toBe(serverBranch);
    expect(serverBranch.className).toBe('no');

    button.click();
    const nextBranch = host.querySelector('p')!;
    expect(nextBranch.className).toBe('yes');
    expect(nextBranch.textContent).toBe('yes');
    expect(nextBranch).not.toBe(serverBranch);
    expect(serverBranch.isConnected).toBe(false);
  });

  it('keeps static siblings around an adopted conditional in authored order', async () => {
    const app = await importCompiled();
    app.setVisible(true);
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = serverHost('<p class="yes">yes</p>');

    mounted = mount('root', app.App);

    const section = host.querySelector('section')!;
    expect(
      Array.from(section.children).map((el) => el.localName),
    ).toEqual(['button', 'p']);
  });

  it('recovers branch tag skew at the conditional owner', async () => {
    const app = await importCompiled();
    app.setVisible(false);
    registerRootFactory(app.App, {
      id: 'App',
      create: () => app.App('App', null),
    });
    const host = serverHost('<div class="no">no</div>');

    mounted = mount('root', app.App);
    expect(host.querySelector('p.no')?.textContent).toBe('no');
    expect(host.querySelector('div.no')).toBeNull();
  });
});
