/**
 * R30 - finite dynamic intrinsic and component tags.
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
  function Summary({ value }) {
    return <output id="summary">summary:{value}</output>;
  }
  function Details({ value }) {
    return <output id="details">details:{value}</output>;
  }

  export function App() {
    let compact = true;
    let detailed = false;
    let value = 1;
    const Tag = compact ? "section" : "article";
    const View = detailed ? Details : Summary;
    const registry = { Shell: "aside" };

    return <main>
      <button id="host" onClick={() => compact = !compact}>host</button>
      <button id="view" onClick={() => detailed = !detailed}>view</button>
      <button id="value" onClick={() => value++}>value</button>
      <button
        id="member"
        onClick={() =>
          registry.Shell = registry.Shell === "aside" ? "nav" : "aside"
        }
      >
        member
      </button>
      <Tag id="dynamic-host" class={{ compact }}>host:{value}</Tag>
      <View value={value} />
      <registry.Shell id="dynamic-member">member</registry.Shell>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r30-dynamic-tags.compiled.ts';
  return import(specifier);
}

describe('R30 - dynamic tags', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r30-dynamic-tags.compiled.ts'),
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

  it('compiles a one-candidate alias directly without a conditional region', () => {
    const code = compile(`
      export function App() {
        const Tag = "section";
        return <Tag id="static-alias">content</Tag>;
      }
    `);
    expect(code).toContain('document.createElement("section")');
    expect(code).not.toContain('.createCondRegion(');
  });

  it('swaps intrinsic, component, and member-selected tags reactively', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#dynamic-host')?.tagName).toBe('SECTION');
    expect(document.querySelector('#summary')?.textContent).toBe('summary:1');
    expect(document.querySelector('#details')).toBeNull();
    expect(document.querySelector('#dynamic-member')?.tagName).toBe('ASIDE');

    document.querySelector<HTMLButtonElement>('#host')!.click();
    expect(document.querySelector('#dynamic-host')?.tagName).toBe('ARTICLE');
    expect(document.querySelector('#dynamic-host')?.textContent).toBe('host:1');

    document.querySelector<HTMLButtonElement>('#view')!.click();
    expect(document.querySelector('#summary')).toBeNull();
    expect(document.querySelector('#details')?.textContent).toBe('details:1');
    expect(
      [..._internals().registry.keys()].some((id) => id.endsWith('/Summary')),
    ).toBe(false);

    document.querySelector<HTMLButtonElement>('#value')!.click();
    expect(document.querySelector('#dynamic-host')?.textContent).toBe('host:2');
    expect(document.querySelector('#details')?.textContent).toBe('details:2');

    document.querySelector<HTMLButtonElement>('#member')!.click();
    expect(document.querySelector('#dynamic-member')?.tagName).toBe('NAV');
  });

  it('supports a module-level reactive tag selector', () => {
    const code = compile(`
      let compact = true;
      const Tag = compact ? "section" : "article";
      export function App() {
        return <Tag>content</Tag>;
      }
    `);
    expect(code).toContain('/$computed/');
    expect(code).toContain('.createCondRegion(');
  });

  it('links finite intrinsic candidates from imported state type unions', () => {
    const output = compileModules({
      './tag-state.ts': `
        export type ContainerTag = "section" | "article" | "aside";
        export let containerTag: ContainerTag = "section";
        export function setContainerTag(next: ContainerTag) {
          containerTag = next;
        }
      `,
      './app.tsx': `
        import { containerTag } from "./tag-state";
        export function App() {
          const LayoutContainerTag = containerTag;
          return <LayoutContainerTag id="layout">content</LayoutContainerTag>;
        }
      `,
    });
    const code = output['./app.tsx'];
    expect(code).toContain('document.createElement("section")');
    expect(code).toContain('document.createElement("article")');
    expect(code).toContain('document.createElement("aside")');
    expect(code).toContain('.createCondRegion(');
  });

  it('normalizes a dynamic component nested in a dynamic intrinsic host', () => {
    const code = compile(`
      function Preview() { return <p>preview</p>; }
      function Code() { return <pre>code</pre>; }
      export function App() {
        let compact = true;
        let preview = true;
        const Host = compact ? "section" : "article";
        const View = preview ? Preview : Code;
        return <Host><View /></Host>;
      }
    `);
    expect(code).toContain('document.createElement("section")');
    expect(code).toContain('document.createElement("article")');
    expect(code).toContain('Preview');
    expect(code).toContain('Code');
    // The nested region is present in each finite host branch, but only the
    // active host branch is instantiated at runtime.
    expect(code.match(/\.createCondRegion\(/g)).toHaveLength(3);
  });

  it('rejects selectors whose possible tag identities are unknown', () => {
    expect(() =>
      compile(`
        function chooseTag() { return Math.random() ? "div" : "span"; }
        export function App() {
          const Tag = chooseTag();
          return <Tag />;
        }
      `),
    ).toThrow(/has no finite string or linked-component candidates/);
  });
});
