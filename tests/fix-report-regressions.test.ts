import { describe, expect, it } from 'vitest';
import {
  compile,
  compileModules,
  toCompilerDiagnostic,
} from '@memoized-dom/compiler';

describe('fix.md regressions', () => {
  it('recognizes keyed maps through optional chaining', () => {
    const code = compile(`
        export function App() {
          let endpoint = '/rows';
          const resource = client.create<{ data?: Array<{ id: string }> }>(endpoint);
          return <ul>{resource.data?.map(row => <li key={row.id}>{row.id}</li>)}</ul>;
        }
      `);

    expect(code).toContain('resource.data ?? []');
  });

  it('links exported functions wrapped in TypeScript assertions', () => {
    expect(() =>
      compileModules({
        './api.ts': `
          type FetchLike = (input: string) => string;
          export const request = ((input: string) => input) as FetchLike;
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

  it('allows opaque third-party method calls on module and instance derivations', () => {
    expect(() =>
      compile(`
        let endpoint = '/first';
        const moduleResource = client.create(endpoint);
        export function App() {
          let localEndpoint = endpoint;
          const instanceResource = client.create(localEndpoint);
          return <div>
            <button onClick={() => moduleResource.reload()}>module</button>
            <button onClick={() => instanceResource.futureMethod()}>instance</button>
          </div>;
        }
      `),
    ).not.toThrow();
  });

  it('still rejects proven writes to derived values', () => {
    expect(() =>
      compile(`
        let endpoint = '/first';
        const resource = client.create(endpoint);
        export function App() {
          return <button onClick={() => { resource.status = 'forced'; }}>bad</button>;
        }
      `),
    ).toThrowError(/cannot mutate computed 'resource'/);
  });

  it('removes ANSI control sequences from diagnostics', () => {
    const diagnostic = toCompilerDiagnostic(
      new Error(
        "./App.tsx: memo-dom: broken\n\x1B[31m>\x1B[39m \x1B[90m1 |\x1B[39m bad",
      ),
      ['./App.tsx'],
    );

    expect(diagnostic.message).toContain('> 1 | bad');
    expect(diagnostic.message).not.toMatch(/\x1B\[/);
  });

  it('uses entity-factory ABI for a listed component that writes a transparent source', () => {
    // A component row with a transparent async source write must be emitted
    // with the entity-factory calling convention: Comp(_id, _parent, _propsBox).
    // Before the fix, buildComponentRowCreate used only isLightweightListedComponent
    // (which returned true) and emitted Comp({ item }, _rowId, ...) — the wrong
    // props-first ABI — causing _propsBox to receive the parent string and
    // `item` to destructure from the entity id, yielding undefined at runtime.
    //
    // The bug requires StoryRow to directly reference a module-scope transparent
    // source (stories) within its body — that adds 'stories' to its transparentSources
    // set, forcing the entity-factory ABI. Mutating stories inside the row
    // component body satisfies this requirement.
    const code = compileModules({
      './session.ts': `
        import { $fetch } from '@memoized-dom/data';
        export const stories = $fetch<Array<{ id: number; title: string }>>('/stories');
      `,
      './app.tsx': `
        import { stories } from './session';
        function StoryRow({ item }) {
          return (
            <li>
              <span>{item.title}</span>
              <button onClick={() => stories.splice(stories.findIndex(s => s.id === item.id), 1)}>
                delete
              </button>
            </li>
          );
        }

        export function App() {
          return (
            <ul>
              {stories.map(s => <StoryRow key={s.id} item={s} />)}
            </ul>
          );
        }
      `,
    });
    // Join all compiled module outputs so assertions work across the bundle.
    const combined = Object.values(code).join('\n');
    // StoryRow must be emitted as entity-factory (has _parent param, uses registerProps)
    // NOT as lightweight (which would be `function StoryRow(item, _id, ...)`)
    expect(combined).toMatch(/function StoryRow\(_id\d*, _parent\d*/);
    expect(combined).toContain('.registerProps(');
    // The create factory must call StoryRow with the entity ABI:
    // StoryRow(_rowId, ownerId, [props]) — NOT StoryRow({ item }, _rowId, ...)
    // Presence of `.registerProps` and absence of props-first call pattern confirms it.
    expect(combined).not.toMatch(/StoryRow\(\s*\{/);
  });
});
