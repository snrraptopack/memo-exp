import { describe, expect, it } from 'vitest';
import {
  EstreeParseError,
  type BaseNode,
  collectNodes,
  findNode,
  isIdentifier,
  isNumericLiteral,
  numericLiteral,
  parseEstree,
  parseEstreeOrThrow,
  printEstree,
  transformAst,
} from '../packages/compiler/src/ast';
import {
  moduleFunctionStringCandidates,
  moduleStateStringCandidates,
} from '../packages/compiler/src/analysis/type-candidates';
import { hostJsxEventNames } from '../packages/compiler/src/jsx/events';
import { callsOnlyCommittedLocalHelpers } from '../packages/compiler/src/handlers/local-calls';

describe('ESTree parser and printer boundary', () => {
  it('parses and prints TSX without a Babel AST conversion', () => {
    const source = `
      // shared counter
      const count: number = 1;
      export function Counter() {
        return <button>{count}</button>;
      }
    `;
    const parsed = parseEstreeOrThrow(source, {
      filename: 'Counter.tsx',
    });

    expect(parsed.program.type).toBe('Program');
    expect(parsed.diagnostics).toEqual([]);
    expect(collectNodes(parsed.program, isIdentifier).map((node) => node.name))
      .toContain('Counter');
    expect(collectNodes(parsed.program, isNumericLiteral).map((node) => node.value))
      .toEqual([1]);

    const printed = printEstree(parsed.program, {
      comments: parsed.comments,
      sourceMapSource: 'Counter.tsx',
      sourceMapContent: source,
    });
    expect(printed.code).toContain('// shared counter');
    expect(printed.code).toContain('const count: number = 1;');
    expect(printed.code).toContain('<button>{count}</button>');
    expect(printed.map?.sources).toEqual(['Counter.tsx']);
    expect(printed.map?.mappings.length).toBeGreaterThan(0);
    expect(
      parseEstree(printed.code, { filename: 'Counter.tsx' }).diagnostics,
    ).toEqual([]);
  });

  it('prints trees containing nodes produced by the ESTree builders', () => {
    const parsed = parseEstreeOrThrow('export const answer = 1;', {
      filename: 'answer.ts',
    });
    const transformed = transformAst(parsed.program, {
      enter(node) {
        return isNumericLiteral(node) && node.value === 1
          ? numericLiteral(42)
          : undefined;
      },
    });

    expect(transformed).not.toBeNull();
    expect(printEstree(transformed!).code).toContain('export const answer = 42;');
    expect(collectNodes(parsed.program, isNumericLiteral)[0]?.value).toBe(1);
  });

  it('returns diagnostics and exposes a typed throwing API', () => {
    const source = 'export const = ;';
    const parsed = parseEstree(source, { filename: 'broken.ts' });
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'Error'))
      .toBe(true);
    expect(() =>
      parseEstreeOrThrow(source, { filename: 'broken.ts' }),
    ).toThrow(EstreeParseError);
  });

  it('feeds TS-ESTree directly into migrated compiler analysis', () => {
    const parsed = parseEstreeOrThrow(
      `
        type ViewTag = 'section' | 'article';
        export let current: Readonly<ViewTag> = 'section';
        export const choose = (): ViewTag => current;
      `,
      { filename: 'views.ts' },
    );

    expect(moduleStateStringCandidates(parsed.program).get('current')).toEqual([
      'section',
      'article',
    ]);
    expect(moduleFunctionStringCandidates(parsed.program).get('choose')).toEqual([
      'section',
      'article',
    ]);
  });

  it('discovers host events directly from parsed ESTree JSX', () => {
    const parsed = parseEstreeOrThrow(
      `
        export function View() {
          return <main onMouseEnter={() => {}}><button onClick={() => {}} /></main>;
        }
      `,
      { filename: 'events.tsx' },
    );

    expect(hostJsxEventNames(parsed.program)).toEqual([
      'onClick',
      'onMouseEnter',
    ]);
  });

  it('classifies handler calls directly from parsed ESTree', () => {
    const parsed = parseEstreeOrThrow(
      `
        const handler = () => {
          save();
          const deferred = () => external();
        };
      `,
      { filename: 'handler.ts' },
    );
    const handler = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'ArrowFunctionExpression',
    );

    expect(handler).not.toBeNull();
    expect(
      callsOnlyCommittedLocalHelpers(handler!, (name) => name === 'save'),
    ).toBe(true);
    expect(callsOnlyCommittedLocalHelpers(handler!, () => false)).toBe(false);
  });
});
