/**
 * Parser-frontend conformance contract.
 *
 * These cases assert authored-language behavior rather than Babel node or
 * generated-code shapes. A future Oxc frontend should run this same suite by
 * supplying its compile and compileModules entry points below.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  compile,
  compileModules,
  type CompileModulesOptions,
  type MemoDomOptions,
} from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

interface CompilerFrontend {
  name: string;
  compile(source: string, options?: MemoDomOptions): string;
  compileModules(
    modules: Readonly<Record<string, string>>,
    options?: CompileModulesOptions,
  ): Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importGenerated(file: string): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(join(outDir, file)).href);
}

const listForms = {
  direct: 'items.map(row => <li key={row.id}>{row.label}</li>)',
  asserted:
    '(items as Item[]).map(row => <li key={row.id}>{row.label}</li>)',
  satisfies:
    '(items satisfies Item[]).map(row => <li key={row.id}>{row.label}</li>)',
  nonNull:
    'items!.map(row => <li key={row.id}>{row.label}</li>)',
  optionalAsserted:
    '(items as Item[] | undefined)?.map(row => <li key={row.id}>{row.label}</li>)',
  optionalDerivedMember:
    '(resource.data as Item[] | undefined)?.map(row => <li key={row.id}>{row.label}</li>)',
  calculated:
    'items.filter(row => row.id > 0).map(row => <li key={row.id}>{row.label}</li>)',
} as const;

function listSource(expression: string): string {
  return `
    interface Item { id: number; label: string }
    function makeResource(data: Item[] | undefined) { return { data }; }

    export function App() {
      let items: Item[] = [
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ];
      const resource = makeResource(items);
      return <main>
        <button id="add" onClick={() => {
          items = [...items, { id: 3, label: 'three' }];
        }}>add</button>
        <ul>{${expression}}</ul>
      </main>;
    }
  `;
}

function defineFrontendConformance(frontend: CompilerFrontend): void {
  const fixturePrefix = `frontend-${frontend.name.replace(/[^a-z0-9]+/gi, '-')}`;

  describe(`${frontend.name} frontend semantic conformance`, () => {
    beforeAll(() => {
      mkdirSync(outDir, { recursive: true });
      for (const [form, expression] of Object.entries(listForms)) {
        writeFileSync(
          join(outDir, `${fixturePrefix}-${form}.compiled.ts`),
          frontend.compile(listSource(expression), {
            runtimePath: '@memoized-dom/runtime',
          }),
        );
      }
      writeFileSync(
        join(outDir, `${fixturePrefix}-nullish.compiled.ts`),
        frontend.compile(
          `
            interface Item { id: number; label: string }
            export function App() {
              const resource: { data: Item[] | undefined } = {
                data: undefined,
              };
              return <ul>{resource.data?.map(row => (
                <li key={row.id}>{row.label}</li>
              ))}</ul>;
            }
          `,
          { runtimePath: '@memoized-dom/runtime' },
        ),
      );
    });

    beforeEach(() => {
      document.body.replaceChildren();
      _internals().registry.forEach((_, id) => unregister(id));
      resetAccessTable();
      setScheduler((run) => run());
    });

    afterEach(() => {
      resetScheduler();
    });

    for (const form of Object.keys(listForms)) {
      it(`preserves list behavior for the ${form} syntax form`, async () => {
        const module = await importGenerated(
          `${fixturePrefix}-${form}.compiled.ts`,
        );
        document.body.appendChild(module.App('App', null));

        const labels = (): string[] =>
          [...document.querySelectorAll('li')].map(
            (node) => node.textContent ?? '',
          );
        expect(labels()).toEqual(['one', 'two']);

        document.querySelector<HTMLButtonElement>('#add')!.click();
        expect(labels()).toEqual(['one', 'two', 'three']);
      });
    }

    it('renders a nullish optional list as an empty region', async () => {
      const module = await importGenerated(
        `${fixturePrefix}-nullish.compiled.ts`,
      );
      expect(() => {
        document.body.appendChild(module.App('App', null));
      }).not.toThrow();
      expect(document.querySelectorAll('li')).toHaveLength(0);
    });

    it.each([
      ['plain', '((input: string) => input)'],
      ['as assertion', '(((input: string) => input) as FetchLike)'],
      ['satisfies', '(((input: string) => input) satisfies FetchLike)'],
      ['non-null', '(((input: string) => input)!)'],
    ])('links function exports through %s wrappers', (_label, initializer) => {
      expect(() =>
        frontend.compileModules({
          './api.ts': `
            type FetchLike = (input: string) => string;
            export const request = ${initializer};
          `,
          './app.tsx': `
            import { request } from './api';
            export function App() {
              return <button onClick={() => request('/items')}>load</button>;
            }
          `,
        }),
      ).not.toThrow();
    });

    it('classifies asserted collection initializers as reactive state', () => {
      expect(() =>
        frontend.compile(`
          interface Item { id: number }
          const items = ([{ id: 1 }] as Item[]);
          export function App() {
            return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>;
          }
        `),
      ).not.toThrow();
    });

    it.each([
      ['named', 'resource.reload()'],
      ['computed', "resource['futureMethod']()"],
    ])('allows %s opaque receiver calls', (_label, invocation) => {
      expect(() =>
        frontend.compile(`
          let endpoint = '/items';
          const resource = client.create(endpoint);
          export function App() {
            return <button onClick={() => ${invocation}}>run</button>;
          }
        `),
      ).not.toThrow();
    });

    it.each([
      ['assignment', "resource.status = 'forced'"],
      ['update', 'resource.count++'],
      ['delete', 'delete resource.status'],
    ])('rejects the proven derived-value %s form', (_label, write) => {
      expect(() =>
        frontend.compile(`
          let endpoint = '/items';
          const resource = client.create(endpoint);
          export function App() {
            return <button onClick={() => { ${write}; }}>run</button>;
          }
        `),
      ).toThrowError(/cannot mutate computed 'resource'/);
    });
  });
}

defineFrontendConformance({
  name: 'babel-prototype',
  compile,
  compileModules,
});
