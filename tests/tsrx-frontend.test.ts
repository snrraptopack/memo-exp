import { describe, expect, it } from 'vitest';
import {
  compile,
  compileDetailed,
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

  it.each([
    [
      'lazy patterns',
      'export function App({ source }) @{ const &{ name } = source; <p>{name}</p> }',
      'reactive binding semantics',
    ],
    [
      'async template control flow',
      'export function App() @{ @try { <p>Ready</p> } @pending { <p>Wait</p> } }',
      'runtime semantics',
    ],
    [
      'dynamic tags',
      'export function App({ tag }) @{ <{tag}>Dynamic</{tag}> }',
      'dynamic <{expression}> tags are not supported yet',
    ],
  ])('rejects unsupported %s intentionally', (_name, source, message) => {
    expect(() => compile(source, { moduleId: './Unsupported.tsrx' }))
      .toThrow(message);
  });
});
