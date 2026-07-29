/**
 * R35 - finite dynamic tag candidates through helpers and typed registries.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const SOURCE = `
  function chooseHost(compact) {
    if (compact) return "section";
    return "article";
  }

  export function App() {
    let compact = true;
    const Host = chooseHost(compact);
    return <main>
      <button id="toggle" onClick={() => compact = !compact}>toggle</button>
      <Host id="host">content</Host>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r35-helper-dynamic-tags.compiled.ts';
  return import(specifier);
}

describe('R35 - helper and registry dynamic tags', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r35-helper-dynamic-tags.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('reactively swaps finite intrinsic tags returned by a local helper', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#host')?.tagName).toBe('SECTION');
    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(document.querySelector('#host')?.tagName).toBe('ARTICLE');
  });

  it('links intrinsic candidates from an imported helper return contract', () => {
    const output = compileModules({
      './layout.ts': `
        export type LayoutTag = "main" | "aside";
        export function chooseLayout(compact: boolean): LayoutTag {
          return compact ? "aside" : "main";
        }
      `,
      './app.tsx': `
        import { chooseLayout } from "./layout";
        export function App() {
          let compact = false;
          const Host = chooseLayout(compact);
          return <Host>content</Host>;
        }
      `,
    });
    const code = output['./app.tsx'];
    expect(code).toContain('document.createElement("main")');
    expect(code).toContain('document.createElement("aside")');
    expect(code).toContain('.createCondRegion(');
  });

  it('links candidates from an imported typed intrinsic registry', () => {
    const output = compileModules({
      './registry.ts': `
        export type LayoutName = "main" | "aside";
        export const LAYOUTS: Record<"wide" | "compact", LayoutName> = {
          wide: "main",
          compact: "aside",
        };
      `,
      './app.tsx': `
        import { LAYOUTS } from "./registry";
        export function App() {
          let compact = false;
          const Host = LAYOUTS[compact ? "compact" : "wide"];
          return <Host>content</Host>;
        }
      `,
    });
    const code = output['./app.tsx'];
    expect(code).toContain('document.createElement("main")');
    expect(code).toContain('document.createElement("aside")');
  });

  it('still rejects helpers without a finite tag contract or finite returns', () => {
    expect(() =>
      compile(`
        function chooseHost() {
          return String(Math.random());
        }
        export function App() {
          const Host = chooseHost();
          return <Host />;
        }
      `),
    ).toThrow(/has no finite string or linked-component candidates/);
  });
});
