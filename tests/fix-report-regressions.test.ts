import { describe, expect, it } from 'vitest';
import {
  compile,
  compileModules,
  toCompilerDiagnostic,
} from '@memoized-dom/compiler';

describe('fix.md regressions', () => {
  it('recognizes keyed maps through optional chaining', () => {
    expect(() =>
      compile(`
        export function App() {
          let endpoint = '/rows';
          const resource = client.create<{ data?: Array<{ id: string }> }>(endpoint);
          return <ul>{resource.data?.map(row => <li key={row.id}>{row.id}</li>)}</ul>;
        }
      `),
    ).not.toThrow();
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
});
