import { describe, expect, it } from 'vitest';
import {
  EstreeParseError,
  analyzeScope,
  type BaseNode,
  collectNodes,
  findNode,
  isIdentifier,
  isJSXElement,
  isNumericLiteral,
  numericLiteral,
  parseEstree,
  parseEstreeOrThrow,
  printEstree,
  removeNode,
  replaceNode,
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
import { isRenderCallbackJsxRoot } from '../packages/compiler/src/components/render-callbacks';
import { scanModuleControlFlow } from '../packages/compiler/src/module-control-flow';
import { analyzeComponentReturns } from '../packages/compiler/src/components/return-plan';
import { collectComponentPropSources } from '../packages/compiler/src/components/prop-origins';
import { scanInstanceControlFlow } from '../packages/compiler/src/analysis/instance-control-flow';
import { scanOpaqueVolatility } from '../packages/compiler/src/analysis/opaque-volatility';
import { resolveLocalHelper } from '../packages/compiler/src/handlers';
import {
  AliasTracker,
  bindingScopeIsProgram,
  moduleOrigin,
} from '../packages/compiler/src/mutation-analysis';
import { summarizeHelper } from '../packages/compiler/src/helper-summaries';
import { scanInstanceDerivations } from '../packages/compiler/src/analysis/instance';
import { normalizeComponentJsxValues } from '../packages/compiler/src/components/jsx-values';
import { normalizeRenderFunctions } from '../packages/compiler/src/components/render-functions';
import { analyzeRouterJsx } from '../packages/compiler/src/router';
import { normalizeDynamicTags } from '../packages/compiler/src/jsx/dynamic-tags';
import { liftModuleStateCells } from '../packages/compiler/src/cells';

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

  it('replaces and removes nodes through ESTree parent metadata', () => {
    const parsed = parseEstreeOrThrow('let first = 1, second = 2;', {
      filename: 'mutate.ts',
    });
    const analysis = analyzeScope(parsed.program);
    const one = collectNodes(parsed.program, isNumericLiteral)[0]!;
    const second = findNode(
      parsed.program,
      (node): node is BaseNode =>
        node.type === 'VariableDeclarator' &&
        (node as unknown as { id?: { name?: string } }).id?.name === 'second',
    );

    expect(second).not.toBeNull();
    replaceNode(analysis, one, numericLiteral(3));
    removeNode(analysis, second!);

    expect(printEstree(parsed.program).code).toContain('let first = 3;');
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
    expect(viewScope?.getBinding('inner')?.constantViolations).toHaveLength(1);
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

  it('finds render-callback JSX roots through ESTree parent metadata', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View() {
          return <List row={(item) => <span>{item}</span>} />;
        }
      `,
      { filename: 'render-callback.tsx' },
    );
    const astAnalysis = analyzeScope(parsed.program);
    const elements = collectNodes(parsed.program, isJSXElement);
    const context = {
      astAnalysis,
      componentProps: new Map([
        [
          'List',
          {
            renderCallbacks: ['row'],
          },
        ],
      ]),
    } as unknown as Ctx;

    expect(elements).toHaveLength(2);
    expect(isRenderCallbackJsxRoot(context, elements[1]!)).toBe(true);
    expect(isRenderCallbackJsxRoot(context, elements[0]!)).toBe(false);
  });

  it('discovers module control-flow derivations from OXC bindings', () => {
    const parsed = parseEstreeOrThrow(
      `
        let count = 0;
        let parity = 'even';
        if (count % 2 === 0) {
          parity = 'even';
        } else {
          parity = 'odd';
        }
      `,
      { filename: 'flow.ts' },
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      state: new Map([['count', 'let']]),
      stateKeys: new Map([['count', './flow.ts#count']]),
      helpers: new Map(),
      importedFunctions: new Map(),
      moduleControlFlow: [],
      rootId: 'App',
      moduleId: './flow.ts',
    } as unknown as Ctx;

    scanModuleControlFlow(
      context,
      {
        node: parsed.program,
        buildCodeFrameError(message) {
          return new Error(message);
        },
      },
      analyzeComputed,
    );

    expect(context.moduleControlFlow).toEqual([
      expect.objectContaining({
        bindings: ['parity'],
        sources: ['count'],
        entityId: 'App/$computed/.%2Fflow.ts#$flow0',
      }),
    ]);
    expect(context.state.get('parity')).toBe('computed');
  });

  it('plans component return branches directly from OXC ESTree', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View(visible: boolean) {
          if (visible) return <main />;
          return null;
        }
      `,
      { filename: 'returns.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );

    expect(component).not.toBeNull();
    const returns = analyzeComponentReturns(
      {
        node: component!,
        buildCodeFrameError(message) {
          return new Error(message);
        },
      } as unknown as Parameters<typeof analyzeComponentReturns>[0],
      'View',
    );

    expect('branches' in returns).toBe(true);
    if ('branches' in returns) {
      expect(returns.branches.map((branch) => branch?.type ?? null)).toEqual([
        'JSXElement',
        null,
      ]);
    }
  });

  it('resolves component prop origins from OXC lexical bindings', () => {
    const parsed = parseEstreeOrThrow(
      `
        let shared = 1;
        function Parent() {
          return <Child value={shared} label={42} />;
        }
      `,
      { filename: 'prop-origins.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode =>
        node.type === 'FunctionDeclaration' &&
        (node as unknown as { id?: { name?: string } }).id?.name === 'Parent',
    );
    const propPlan = {
      mode: 'positional' as const,
      names: [],
      acceptsUnknown: false,
      bindings: [],
      params: [],
      hasWholeDefault: false,
      renderProps: [],
      renderCallbacks: [],
      refProps: [],
    };
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([['Parent', { node: component! }]]),
      componentProps: new Map([
        ['Parent', propPlan],
        ['Child', { ...propPlan, names: ['value', 'label'] }],
      ]),
      state: new Map([['shared', 'let']]),
      stateKeys: new Map([['shared', './prop-origins.tsx#shared']]),
      transparentSources: new Map(),
      instanceState: new Map(),
      instanceDerivedBindings: new Map(),
      moduleId: './prop-origins.tsx',
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    expect(collectComponentPropSources(context, 'Parent')).toEqual(
      new Map([
        [
          'Child',
          {
            value: [
              { type: 'state', key: './prop-origins.tsx#shared' },
            ],
            label: [{ type: 'local' }],
          },
        ],
      ]),
    );
  });

  it('classifies instance control flow from OXC bindings and violations', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View(active: boolean) {
          let label = 'off';
          if (active) label = 'on';
          return <p>{label}</p>;
        }
      `,
      { filename: 'instance-flow.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([['View', { node: component! }]]),
      componentProps: new Map([
        [
          'View',
          {
            bindings: ['active'],
          },
        ],
      ]),
      instanceState: new Map([['View', new Set(['label'])]]),
      instanceDerivedBindings: new Map<string, Set<string>>(),
      instanceControlFlow: new Map(),
      state: new Map(),
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    scanInstanceControlFlow(context);

    expect(context.instanceControlFlow.get('View')).toEqual([
      expect.objectContaining({
        bindings: ['label'],
        sources: ['active'],
        resets: [
          expect.objectContaining({ binding: 'label' }),
        ],
      }),
    ]);
    expect(context.instanceDerivedBindings.get('View')).toEqual(
      new Set(['label']),
    );
    expect(context.instanceState.get('View')).toEqual(new Set());
  });

  it('propagates opaque import volatility through an OXC component', () => {
    const parsed = parseEstreeOrThrow(
      `
        import { createClient } from 'external-client';
        function View() {
          const client = createClient();
          return <p>{client.value}</p>;
        }
      `,
      { filename: 'opaque.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([['View', { node: component! }]]),
      importedState: new Map(),
      importedComponents: new Map(),
      importedFunctions: new Map(),
      state: new Map(),
      instanceState: new Map(),
      instanceDerivedBindings: new Map(),
      componentProps: new Map([['View', { bindings: [] }]]),
      opaqueBindings: new Map(),
      volatileComponents: new Set(),
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    scanOpaqueVolatility(context);

    expect(context.opaqueBindings.get('View')).toEqual(
      new Set(['createClient', 'client']),
    );
    expect(context.volatileComponents).toEqual(new Set(['View']));
  });

  it('resolves component-local helpers from the OXC scope index', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View() {
          const save = () => commit();
          return <button onClick={save} />;
        }
      `,
      { filename: 'helper.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
    } as unknown as Ctx;
    const componentPath = {
      node: component!,
    } as unknown as Parameters<typeof resolveLocalHelper>[1];

    expect(component).not.toBeNull();
    expect(resolveLocalHelper(context, componentPath, 'save')?.type).toBe(
      'ArrowFunctionExpression',
    );
    expect(resolveLocalHelper(context, componentPath, 'missing')).toBeNull();
  });

  it('tracks reactive aliases with the OXC scope index', () => {
    const parsed = parseEstreeOrThrow(
      `
        let store = { user: { name: 'Ada' } };
        function View() {
          const alias = store.user;
          return <p>{alias.name}</p>;
        }
      `,
      { filename: 'aliases.tsx' },
    );
    const analysis = analyzeScope(parsed.program);
    const declarator = findNode(
      parsed.program,
      (node): node is BaseNode =>
        node.type === 'VariableDeclarator' &&
        (node as unknown as { id?: { name?: string } }).id?.name === 'alias',
    );
    const members = collectNodes(
      parsed.program,
      (node): node is BaseNode => node.type === 'MemberExpression',
    );
    const rendered = members.find(
      (member) =>
        (member as unknown as { object?: { name?: string } }).object?.name ===
        'alias',
    );
    const aliases = new AliasTracker((name, binding) =>
      binding !== undefined && bindingScopeIsProgram(binding)
        ? moduleOrigin(name, 'store')
        : null,
    );

    expect(declarator).not.toBeNull();
    expect(rendered).not.toBeUndefined();
    aliases.trackDeclarator(
      analysis.nodeToScope.get(declarator!)!,
      declarator as unknown as Parameters<AliasTracker['trackDeclarator']>[1],
    );
    expect(
      aliases.resolveExpression(
        analysis.nodeToScope.get(rendered!)!,
        rendered as unknown as Parameters<AliasTracker['resolveExpression']>[1],
      ),
    ).toEqual({
      locality: 'module',
      root: 'store',
      key: 'store.user.name',
      stateKind: 'store',
    });
  });

  it('summarizes helper writes directly from OXC ESTree', () => {
    const parsed = parseEstreeOrThrow(
      `
        let store = { count: 0 };
        function mutate(target: { value: number }) {
          target.value++;
          store.count++;
          return store.count;
        }
      `,
      { filename: 'summary.ts' },
    );
    const helper = findNode(
      parsed.program,
      (node): node is BaseNode =>
        node.type === 'FunctionDeclaration' &&
        (node as unknown as { id?: { name?: string } }).id?.name === 'mutate',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      helpers: new Map([['mutate', { node: helper! }]]),
      helperSummaries: new Map(),
      state: new Map([['store', 'store']]),
      importedFunctions: new Map(),
    } as unknown as Ctx;

    expect(helper).not.toBeNull();
    const summary = summarizeHelper(context, 'mutate');
    expect(summary.parameterWrites).toEqual([{ index: 0, path: ['value'] }]);
    expect(summary.writes).toEqual(new Set(['store.count']));
    expect(summary.unbounded).toBe(false);
  });

  it('discovers component derivations directly from OXC ESTree', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View(count: number) {
          const doubled = count * 2;
          return <p>{doubled}</p>;
        }
      `,
      { filename: 'instance-derived.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([
        [
          'View',
          {
            node: component!,
            buildCodeFrameError(message: string) {
              return new Error(message);
            },
          },
        ],
      ]),
      componentProps: new Map([['View', { bindings: ['count'] }]]),
      opaqueBindings: new Map(),
      transparentSources: new Map(),
      transparentSourceFactories: new Set(),
      instanceState: new Map(),
      state: new Map(),
      helpers: new Map(),
      importedFunctions: new Map(),
      instanceDerivations: new Map(),
      instanceDerivedBindings: new Map(),
      instanceReasonIds: new Map(),
      selectiveDerivationComponents: new Set(),
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    scanInstanceDerivations(context);

    expect(context.instanceDerivations.get('View')).toEqual([
      expect.objectContaining({
        bindings: ['doubled'],
        sources: ['count'],
      }),
    ]);
    expect(context.instanceDerivedBindings.get('View')).toEqual(
      new Set(['doubled']),
    );
  });

  it('expands component JSX aliases directly on an OXC tree', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View() {
          const content = <span />;
          return <main>{content}</main>;
        }
      `,
      { filename: 'jsx-alias.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([
        [
          'View',
          {
            node: component!,
            buildCodeFrameError(message: string) {
              return new Error(message);
            },
          },
        ],
      ]),
      componentProps: new Map(),
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    normalizeComponentJsxValues(context);

    expect(collectNodes(parsed.program, isJSXElement)).toHaveLength(2);
    const output = printEstree(parsed.program).code;
    expect(output).not.toContain('const content');
    expect(output).not.toContain('{content}');
  });

  it('expands local render functions directly on an OXC tree', () => {
    const parsed = parseEstreeOrThrow(
      `
        function View() {
          const renderName = (name: string) => <span>{name}</span>;
          return <main>{renderName('Ada')}</main>;
        }
      `,
      { filename: 'render-function.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([
        [
          'View',
          {
            node: component!,
            buildCodeFrameError(message: string) {
              return new Error(message);
            },
          },
        ],
      ]),
      jsxHelpers: new Map(),
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    normalizeRenderFunctions(context);

    const output = printEstree(parsed.program).code;
    expect(output).not.toContain('renderName');
    expect(output).toContain("<span>{'Ada'}</span>");
  });

  it('discovers and erases route attributes on an OXC tree', () => {
    const parsed = parseEstreeOrThrow(
      `function App() { return <main route="/"><section /></main>; }`,
      { filename: 'route.tsx' },
    );
    const context = {
      moduleId: './route.tsx',
      routeElements: new Map(),
      localRoutes: [],
      linkedRoutes: undefined,
      usesRouter: false,
    } as unknown as Ctx;

    analyzeRouterJsx(context, {
      node: parsed.program as unknown as Parameters<typeof analyzeRouterJsx>[1]['node'],
      buildCodeFrameError(message) {
        return new Error(message);
      },
    });

    expect(context.localRoutes).toEqual([
      expect.objectContaining({
        moduleId: './route.tsx',
        pattern: '/',
        fullPattern: '/',
      }),
    ]);
    expect(context.usesRouter).toBe(true);
    expect(printEstree(parsed.program).code).not.toContain('route=');
  });

  it('lowers a finite dynamic tag directly on an OXC tree', () => {
    const parsed = parseEstreeOrThrow(
      `function View() { const Tag = 'section'; return <Tag />; }`,
      { filename: 'dynamic-tag.tsx' },
    );
    const component = findNode(
      parsed.program,
      (node): node is BaseNode => node.type === 'FunctionDeclaration',
    );
    const context = {
      astAnalysis: analyzeScope(parsed.program),
      compPaths: new Map([
        [
          'View',
          {
            node: component!,
            buildCodeFrameError(message: string) {
              return new Error(message);
            },
          },
        ],
      ]),
      comps: new Map(),
      importedComponents: new Map(),
      componentProps: new Map(),
      stateTagCandidates: new Map(),
      functionTagCandidates: new Map(),
      stateComponentCandidates: new Map(),
      functionComponentCandidates: new Map(),
    } as unknown as Ctx;

    expect(component).not.toBeNull();
    normalizeDynamicTags(context);

    const output = printEstree(parsed.program).code;
    expect(output).toContain('<section />');
    expect(output).not.toContain('<Tag');
  });

  it('lowers module-state reads and writes on an OXC tree', () => {
    const parsed = parseEstreeOrThrow(
      `
        let count = 1;
        count = 2;
        function View() { return <p>{count}</p>; }
      `,
      { filename: 'cells.tsx' },
    );
    const context = {
      moduleStateCells: true,
      state: new Map([['count', 'let']]),
      stateKeys: new Map([['count', './cells.tsx#count']]),
      header: [],
      identifiers: new GeneratedIdentifiers(parsed.program),
      astAnalysis: analyzeScope(parsed.program),
    } as unknown as Ctx;

    liftModuleStateCells(context, {
      node: parsed.program as unknown as Parameters<typeof liftModuleStateCells>[1]['node'],
      buildCodeFrameError(message) {
        return new Error(message);
      },
    });

    const calls = collectNodes(
      parsed.program,
      (node): node is BaseNode => node.type === 'CallExpression',
    );
    const methods = calls.flatMap((call) => {
      const callee = (call as unknown as { callee?: BaseNode }).callee;
      const property = (callee as unknown as { property?: { name?: string } })
        ?.property;
      return property?.name === undefined ? [] : [property.name];
    });
    expect(methods).toContain('setCell');
    expect(methods).toContain('readCell');
    expect(context.header).toHaveLength(1);
  });
});
