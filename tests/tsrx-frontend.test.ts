import { describe, expect, it } from 'vitest';
import {
  compile,
  compileDetailed,
  compileModules,
  experimentalTsrxEstreeFrontend,
  parseTsrxEstree,
} from '../packages/compiler/src';
import { collectNodes, type BaseNode } from '../packages/compiler/src/ast';

const extensionTypes = new Set([
  'JSXCodeBlock',
  'JSXIfExpression',
  'JSXForExpression',
  'JSXSwitchExpression',
  'JSXTryExpression',
  'JSXStyleElement',
]);

describe('experimental TSRX frontend', () => {
  it('lowers statement containers and nested template control flow', () => {
    const source = `
      export function App({ ok }: { ok: boolean }) @{
        const title = 'Hello';
        <main>
          @if (ok) { <h1>{title}</h1> }
          @else { <p>Not ready</p> }
        </main>
      }
    `;
    const parsed = parseTsrxEstree(source, { filename: './App.tsrx' });

    expect(parsed.diagnostics).toEqual([]);
    expect(
      collectNodes(parsed.program, (node): node is BaseNode =>
        extensionTypes.has(node.type),
      ),
    ).toEqual([]);

    const code = compile(source, { moduleId: './App.tsrx' });
    expect(code).toContain('createCondRegion');
    expect(code).toContain('createElement("main")');
    expect(code).not.toContain('@if');
  });

  it('lowers nested statement containers through shared JSX render expansion', () => {
    const source = `
      export function App({ value }: { value: string }) @{
        <main>
          @{
            const label = value.toUpperCase();
            <strong>{label}</strong>
          }
        </main>
      }
    `;
    const parsed = parseTsrxEstree(source, { filename: './Nested.tsrx' });

    expect(parsed.diagnostics).toEqual([]);
    expect(
      collectNodes(parsed.program, (node): node is BaseNode =>
        extensionTypes.has(node.type),
      ),
    ).toEqual([]);

    const code = compile(source, { moduleId: './Nested.tsrx' });
    expect(code).toContain('createElement("strong")');
    expect(code).not.toContain('JSXCodeBlock');
  });

  it('maps keyed @for and @empty onto list and conditional regions', () => {
    const code = compile(
      `
        export function App({ items }: {
          items: Array<{ id: number; name: string }>;
        }) @{
          <main>
            @for (const item of items; index i; key item.id) {
              <span>{i}:{item.name}</span>
            } @empty {
              <em>Empty</em>
            }
          </main>
        }
      `,
      { moduleId: './List.tsrx' },
    );

    expect(code).toContain('createListRegion');
    expect(code).toContain('createCondRegion');
    expect(code).toContain('(item, i) => item.id');
  });

  it('maps a root @switch onto the component return planner', () => {
    const code = compile(
      `
        export function App({ value }: { value: number }) @{
          @switch (value) {
            @case 1: { <p>One</p> }
            @default: { <p>Other</p> }
          }
        }
      `,
      { moduleId: './Switch.tsrx' },
    );

    expect(code).toContain('createCondRegion');
    expect(code).toContain('switch (value)');
  });

  it('maps nested @switch through shared exhaustive render expansion', () => {
    const code = compile(
      `
        export function App({ value }: { value: number }) @{
          <main>
            @switch (value) {
              @case 1: { <strong>One</strong> }
              @case 2: { <em>Two</em> }
              @default: { <span>Other</span> }
            }
          </main>
        }
      `,
      { moduleId: './NestedSwitch.tsrx' },
    );

    expect(code).toContain('createElement("main")');
    expect(code).toContain('createElement("strong")');
    expect(code).toContain('createElement("em")');
    expect(code).toContain('createElement("span")');
    expect(code).toContain('createCondRegion');
  });

  it('supports pure setup local to @if, @switch, and @empty branches', () => {
    const conditional = compile(
      `
        export function App({ ready, value }: {
          ready: boolean;
          value: string;
        }) @{
          <main>
            @if (ready) {
              const label = value.toUpperCase();
              <strong>{label}</strong>
            } @else {
              const label = value.toLowerCase();
              <em>{label}</em>
            }
          </main>
        }
      `,
      { moduleId: './BranchIf.tsrx' },
    );
    expect(conditional).toContain('createElement("strong")');
    expect(conditional).toContain('createElement("em")');
    expect(conditional).toContain('createCondRegion');

    const switched = compile(
      `
        export function App({ value }: { value: number }) @{
          @switch (value) {
            @case 1: {
              const oneLabel = 'One';
              <strong>{oneLabel}</strong>
            }
            @default: {
              const otherLabel = 'Other';
              <em>{otherLabel}</em>
            }
          }
        }
      `,
      { moduleId: './BranchSwitch.tsrx' },
    );
    expect(switched).toContain('createElement("strong")');
    expect(switched).toContain('createElement("em")');
    expect(switched).toContain('switch (value)');

    const empty = compile(
      `
        export function App({ items }: { items: string[] }) @{
          <main>
            @for (const item of items) { <span>{item}</span> }
            @empty {
              const label = 'Nothing here';
              <em>{label}</em>
            }
          </main>
        }
      `,
      { moduleId: './BranchEmpty.tsrx' },
    );
    expect(empty).toContain('createListRegion');
    expect(empty).toContain('createElement("em")');
    expect(empty).toContain('createCondRegion');
  });

  it('maps finite dynamic intrinsic tags onto the existing dynamic region planner', () => {
    const code = compile(
      `
        export function App({ compact }: { compact: boolean }) @{
          <main>
            <{compact ? 'span' : 'section'}>Content</{compact ? 'span' : 'section'}>
          </main>
        }
      `,
      { moduleId: './DynamicIntrinsic.tsrx' },
    );

    expect(code).toContain('createCondRegion');
    expect(code).toContain('createElement("span")');
    expect(code).toContain('createElement("section")');
    expect(code).not.toContain('createElement("TsrxDynamic');
  });

  it('links finite dynamic component tags across TSRX modules', () => {
    const output = compileModules({
      './App.tsrx': `
        import { Card } from './Card.tsrx';
        import { List } from './List.tsrx';
        export function App({ compact }: { compact: boolean }) @{
          <main><{compact ? Card : List} /></main>
        }
      `,
      './Card.tsrx': `export function Card() @{ <article>Card</article> }`,
      './List.tsrx': `export function List() @{ <ul><li>List</li></ul> }`,
    });

    expect(output['./App.tsrx']).toContain('createCondRegion');
    expect(output['./App.tsrx']).toContain('Card(');
    expect(output['./App.tsrx']).toContain('List(');
  });

  it('supports the official finite prop-union dynamic intrinsic shape', () => {
    const code = compile(
      `
        type PanelProps = { as?: 'section' | 'article' };
        export function Panel({ as = 'section' }: PanelProps) @{
          <{as} class="panel">Content</{as}>
        }
      `,
      { moduleId: './Panel.tsrx' },
    );

    expect(code).toContain('createElement("section")');
    expect(code).toContain('createElement("article")');
    expect(code).toContain('createCondRegion');
  });

  it('maps lazy destructuring onto native reactive destructuring replay', () => {
    const output = compileModules({
      './App.tsrx': `
        import { UserCard } from './UserCard.tsrx';
        export function App({ name, age }: {
          name: string;
          age: number;
        }) @{ <UserCard {name} {age} /> }
      `,
      './UserCard.tsrx': `
        type Props = { name: string; age: number };
        export function UserCard(&{ name, age }: Props) @{
          <article><h2>{name}</h2><p>{age}</p></article>
        }
      `,
    });

    expect(output['./UserCard.tsrx']).not.toContain('__lazy');
    expect(output['./UserCard.tsrx']).toContain('createElement("article")');
    expect(output['./App.tsrx']).toContain('UserCard(');

    const local = compile(
      `
        export function App({ source }: {
          source: { name: string };
        }) @{
          const &{ name } = source;
          <strong>{name}</strong>
        }
      `,
      { moduleId: './LocalLazy.tsrx' },
    );
    expect(local).not.toContain('__lazy');
    expect(local).toContain('createElement("strong")');

    const array = compile(
      `
        export function App({ source }: { source: string[] }) @{
          const &[first] = source;
          <strong>{first}</strong>
        }
      `,
      { moduleId: './LocalLazyArray.tsrx' },
    );
    expect(array).not.toContain('__lazy');
    expect(array).toContain('createElement("strong")');

    const dynamic = compile(
      `
        export function Panel(
          &{ as }: { as: 'section' | 'article' }
        ) @{ <{as}>Content</{as}> }
      `,
      { moduleId: './LazyDynamic.tsrx' },
    );
    expect(dynamic).toContain('createElement("section")');
    expect(dynamic).toContain('createElement("article")');
    expect(dynamic).toContain('createCondRegion');

    const writeSource = `
      export function App(&{ value }: { value: number }) @{
        function increment() { value++; }
        <button onClick={increment}>{value}</button>
      }
    `;
    const rejectedWrite = parseTsrxEstree(writeSource, {
      filename: './LazyWrite.tsrx',
    });
    expect(rejectedWrite.diagnostics).toHaveLength(1);
    expect(rejectedWrite.diagnostics[0]!.message).toContain(
      "lazy binding 'value' cannot be assigned directly",
    );
    const writeLabel = rejectedWrite.diagnostics[0]!.labels[0]!;
    expect(writeSource.slice(writeLabel.start, writeLabel.end)).toBe('value++');
    expect(() => compile(writeSource, { moduleId: './LazyWrite.tsrx' }))
      .toThrow("lazy binding 'value' cannot be assigned directly");
  });

  it('lowers a suspended @try boundary onto colorless data readiness', () => {
    const output = compileModules({
      './App.tsrx': `
        import { $fetch } from '@memoized-dom/data';

        interface User { name: string; }

        function Dashboard({ user }: { user: User }) @{
          <main>{user.name}</main>
        }

        export function App() @{
          const user = $fetch<User>('/api/user');
          @try {
            <Dashboard suspend {user} />
          } @pending {
            <p>Loading dashboard</p>
          } @catch (error, reset) {
            <button onClick={reset}>{error.message}</button>
          }
        }
      `,
    });
    const code = output['./App.tsrx'];
    expect(code).not.toContain('suspend');
    expect(code).toContain('createCondRegion');
    expect(code).toContain('resolvedValuesPending');
    expect(code).toContain('retryResolvedValues');
    expect(code).toContain('Loading dashboard');
  });

  it('preserves module-state provenance through derived @for component props', () => {
    const output = compileModules({
      './state.ts': `
        export const columns = [{
          id: 'todo',
          tasks: [{ id: 1, done: false }],
        }];
        export function toggle(task: { id: number; done: boolean }) {
          task.done = !task.done;
        }
      `,
      './App.tsrx': `
        import { columns } from './state';
        import { Column } from './Column.tsrx';
        export function App() @{
          <main>
            @for (const column of columns; key column.id) {
              <Column {column} />
            }
          </main>
        }
      `,
      './Column.tsrx': `
        import { Card } from './Card.tsrx';
        export function Column({ column }) @{
          const visible = column.tasks.filter((task) => !task.done);
          <section>
            @for (const task of visible; key task.id) {
              <Card {task} />
            } @empty {
              <p>Complete</p>
            }
          </section>
        }
      `,
      './Card.tsrx': `
        import { toggle } from './state';
        export function Card({ task }) @{
          <button onClick={() => toggle(task)}>{String(task.done)}</button>
        }
      `,
    });

    expect(output['./Card.tsrx']).toContain('./state.ts#columns');
    expect(output['./Card.tsrx']).toContain('commitWrites');
    expect(output['./Card.tsrx']).not.toContain('markDirtySubtree');
  });

  it('extracts scoped styles, annotates JSX class names with hashes, and strips style tags', () => {
    const source = `
      export function Card() @{
        <div class="card">
          <style>
            .card { color: red; }
            .title { font-weight: bold; }
          </style>
          <span class="title">Hello</span>
        </div>
      }
    `;
    const parsed = parseTsrxEstree(source, { filename: './Card.tsrx' });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.css).toContain('.card');
    expect(parsed.css).toContain('color: red');

    const result = compileDetailed(source, { moduleId: './Card.tsrx' });
    expect(result.css).toBeDefined();
    expect(result.css).toContain('.card');
    expect(result.code).toContain('createElement("div")');
    expect(result.code).not.toContain('<style');
    expect(result.code).not.toContain('color: red');
  });

  it('requires virtual and unknown extensions to select a frontend explicitly', () => {
    const source = 'export function App() @{ <main>Hi</main> }';
    expect(() => compile(source, { moduleId: 'virtual:memoized-app' }))
      .toThrow('pass a frontend explicitly');

    const code = compile(source, {
      moduleId: 'virtual:memoized-app',
      frontend: experimentalTsrxEstreeFrontend,
    });
    expect(code).toContain('createElement("main")');
  });

  it('runs the official target-neutral TSRX semantic validation pass', () => {
    const source = `
      function unusedTemplate() {
        <p>Invalid</p>;
      }
      export function App() @{ <main>{unusedTemplate.name}</main> }
    `;
    const parsed = parseTsrxEstree(source, { filename: './UnusedTemplate.tsrx' });

    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]!.message).toContain(
      'This TSRX template output is unused',
    );
    const label = parsed.diagnostics[0]!.labels[0]!;
    expect(source.slice(label.start, label.end)).toBe('<p>Invalid</p>');
  });

  it('rejects a dynamic tag whose expression has no finite candidates', () => {
    expect(() =>
      compile(
        'export function App({ tag }: { tag: string }) @{ <{tag}>Dynamic</{tag}> }',
        { moduleId: './UnboundedTag.tsrx' },
      ),
    ).toThrow('has no finite string or linked-component candidates');
  });
});
