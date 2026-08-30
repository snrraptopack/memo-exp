import { describe, expect, it } from 'vitest';
import {
  EstreeParseError,
  analyzeScope,
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
import { renderPropReferenceName } from '../packages/compiler/src/components/children';
import type { Ctx } from '../packages/compiler/src/context';
import {
  isStaticListExpression,
  isStaticPrimitiveList,
} from '../packages/compiler/src/lists/source-shapes';
import { analyzeComputed } from '../packages/compiler/src/analysis/computed';
import { cloneRuntimeBindingPattern } from '../packages/compiler/src/analysis/runtime-pattern';
import { isStaticDerivedChain } from '../packages/compiler/src/lists/static-derived';
import { discoverComponentExports } from '../packages/compiler/src/components/manifest';
import { GeneratedIdentifiers } from '../packages/compiler/src/identifiers';

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

  it('matches component prop references from parsed ESTree', () => {
    const parsed = parseEstreeOrThrow('target;', { filename: 'ref.ts' });
    const target = findNode(parsed.program, isIdentifier);
    const context = {
      componentProps: new Map([
        [
          'View',
          {
            mode: 'positional',
            names: ['target'],
            acceptsUnknown: false,
            bindings: ['target'],
            params: [],
            hasWholeDefault: false,
            renderProps: [],
            renderCallbacks: [],
            refProps: [],
          },
        ],
      ]),
      instanceDerivedBindings: new Map(),
    } as unknown as Ctx;

    expect(target).not.toBeNull();
    expect(renderPropReferenceName(context, 'View', target!)).toBe('target');
  });

  it('recognizes static list sources from parsed ESTree', () => {
    const parsed = parseEstreeOrThrow(
      `['a', 'b'].map((value) => value.toUpperCase());`,
      { filename: 'list.ts' },
    );
    const array = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'ArrayExpression',
    );
    const chain = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'CallExpression',
    );

    expect(array).not.toBeNull();
    expect(chain).not.toBeNull();
    expect(isStaticPrimitiveList(array!)).toBe(true);
    expect(isStaticListExpression(chain!)).toBe(true);
    expect(isStaticDerivedChain(chain!)).toBe(true);
  });

  it('analyzes computed state reads from parsed ESTree', () => {
    const parsed = parseEstreeOrThrow('store.total + count;', {
      filename: 'computed.ts',
    });
    const expression = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'BinaryExpression',
    );
    const context = {
      state: new Map([
        ['store', 'store'],
        ['count', 'let'],
      ]),
      helpers: new Map(),
      importedFunctions: new Map(),
    } as unknown as Ctx;

    expect(expression).not.toBeNull();
    const result = analyzeComputed(context, expression!);
    expect(result.impure).toBe(false);
    expect([...result.reads].sort()).toEqual([
      'count',
      'store',
      'store.total',
    ]);
  });

  it('strips runtime pattern annotations from parsed TS-ESTree', () => {
    const parsed = parseEstreeOrThrow(
      'const read = ({ value }: { value: string }) => value;',
      { filename: 'pattern.ts' },
    );
    const pattern = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'ObjectPattern',
    );

    expect(pattern).not.toBeNull();
    const cloned = cloneRuntimeBindingPattern(pattern!);
    const originalAnnotation = (
      pattern as unknown as Record<string, unknown>
    ).typeAnnotation;
    const clonedAnnotation = (
      cloned as unknown as Record<string, unknown>
    ).typeAnnotation;
    expect(originalAnnotation).not.toBeNull();
    expect(cloned).not.toBe(pattern);
    expect(clonedAnnotation).toBeNull();
  });

  it('discovers component exports directly from an OXC program', () => {
    const parsed = parseEstreeOrThrow(
      `
        interface CardProps {
          title: string;
          onSave(): void;
        }
        export function Card(
          { title, onSave, ...rest }: CardProps,
        ) {
          return <button onClick={onSave}>{title}</button>;
        }
        function helper() { return 1; }
      `,
      { filename: 'card.tsx' },
    );

    const components = discoverComponentExports(parsed.program, './card.tsx');
    expect(components.get('Card')).toMatchObject({
      key: './card.tsx#Card',
      props: ['title', 'onSave'],
      objectProps: true,
      acceptsUnknownProps: true,
      delegatedEvents: ['onClick'],
    });
    expect(components.has('helper')).toBe(false);
  });

  it('builds lexical bindings and parent metadata from OXC TS-ESTree', () => {
    const parsed = parseEstreeOrThrow(
      `
        import fallback, { thing as alias } from 'values';
        const top = 1;
        export function View(
          { item: local = top, ...rest }: Props,
        ) {
          let inner = local;
          { const top = 2; inner += top; }
          return <div>{inner}{alias}{rest.extra}</div>;
        }
      `,
      { filename: 'scope.tsx' },
    );
    const analysis = analyzeScope(parsed.program);
    const view = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );

    expect(view).not.toBeNull();
    expect([...analysis.rootScope.bindings.keys()].sort()).toEqual([
      'View',
      'alias',
      'fallback',
      'top',
    ]);
    expect(analysis.rootScope.getBinding('top')?.references).toHaveLength(1);
    expect(analysis.rootScope.getBinding('alias')?.references).toHaveLength(1);
    const viewScope = analysis.nodeToScope.get(view!);
    expect([...viewScope!.bindings.keys()].sort()).toEqual([
      'inner',
      'local',
      'rest',
    ]);
    expect(viewScope?.getBinding('local')?.references).toHaveLength(1);
    expect(viewScope?.getBinding('inner')?.references).toHaveLength(2);
    expect(analysis.parentByNode.get(view!)).toMatchObject({
      type: 'ExportNamedDeclaration',
    });
  });

  it('allocates collision-free compiler identifiers from an OXC program', () => {
    const parsed = parseEstreeOrThrow('const _MD = 1, _value = 2;', {
      filename: 'identifiers.ts',
    });
    const identifiers = new GeneratedIdentifiers(parsed.program);

    expect(identifiers.runtimeId).toBe('_MD2');
    expect(identifiers.routerId).toBe('_MR');
    expect(identifiers.dataRuntimeId).toBe('_MDD');
    expect(identifiers.generate('value').name).toBe('_value2');
  });
});
