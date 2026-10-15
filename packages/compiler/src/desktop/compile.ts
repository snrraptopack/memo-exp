/** First executable backend: fixed hosts and shared module-cell publication. */

import * as b from '../ast/factory';
import type * as t from '../ast/compiler-types';

import {
  cloneNode,
  memoizedEstreeFrontend,
  normalizeEstreeDialect,
  parseWithEstreeFrontendOrThrow,
  printEstree,
  stripTypeScript,
  walkAst,
  type EstreeFrontend
} from '../ast';

import { createAnalysisCtx, type AnalysisOptions, type ProgramPath } from '../context/model';
import { astBindingAt, variableDeclaratorFor, unwrapTypeExpression } from '../context';
import { prepareSemanticAnalysis } from '../analysis/pipeline';
import { planAccessReaders } from '../analysis/access-table';
import { planExpressionSources } from '../planning/expression-sources';
import { planComponentPulls } from '../planning/primitive-pull';
import { planComponentPlacements } from '../planning/component-placement';
import { planRegionReplays } from '../planning/region-replay';
import { planComponentListSites } from '../planning/list-sites';
import { planComponentCallbacks } from '../planning/component-callbacks';
import { planComponentRendering } from '../planning/component-render';
import { isRenderPropReference } from '../analysis/render-prop-reference';
import type { BaseNode } from '../ast';
import { liftModuleStateCells, type CellEmissionContext } from '../cells';
import { emitAccessTable } from '../emission/access-table';
import {
  buildPropDeclaration,
  buildPropReplay,
} from '../components/prop-runtime';

import {
  generatedIdentifier,
  initializeGeneratedIdentifiers,
  requireIdentifiers
} from '../emission/identifiers';

import { compilerError } from '../errors';
import { isIntrinsicLifecycleCall, planCompilerIntrinsics } from '../intrinsics';
import { planModuleCallbacks } from '../planning/module-callbacks';
import { memberRootName } from '../context';
import { desktopAnalysisProfile } from './analyze';
import { normalizeComponentJsxValues } from '../components/jsx-values';
import { lowerNativeTemplate } from './template';
import type { NativeTemplatePlan } from './template-plan';
import {
  emitNativeView,
  nativeEvaluation,
  validateNativeTemplatePlan,
  withTemplateRevision,
} from './view-emission';

export interface DesktopCompileOptions extends AnalysisOptions {
  readonly frontend?: EstreeFrontend;
  /** Compiler-private presentation adapter selected by the desktop build. */
  readonly presentationPath?: string
  readonly stylesheetImports?: 'preserve';
  /** Whole-project compilation registers only the graph's mounted root. */
  readonly registerRoot?: boolean;
}

export function compileDesktop(source: string, options: DesktopCompileOptions = {}) {
  const moduleId = options.moduleId ?? './App.tsx';
  const parsed = parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend, source, { filename: moduleId });
  const program = parsed.program as t.Program;

  const fail = (message: string, at: t.Node = program): never => {
    throw compilerError('memo-dom desktop: ' + message, moduleId, at);
  };

  if (parsed.css && options.stylesheetImports !== 'preserve') {
    fail('Stylesheet emission requires native CSS/asset integration');
  }
  for (const statement of program.body) {
    if (b.isImportDeclaration(statement) && statement.source.value.endsWith('.css')) {
      if (options.stylesheetImports !== 'preserve') {
        fail('Stylesheet imports require native CSS/asset integration', statement);
      }
      if (statement.specifiers.length) {
        fail('CSS module bindings require stylesheet export integration', statement);
      }
    }
  }

  const path: ProgramPath = {
    node: program,
    buildCodeFrameError: (message, at = program) => compilerError(message, moduleId, at)
  };

  const ctx: CellEmissionContext = Object.assign(
    createAnalysisCtx({
      ...options,
      moduleId,
      moduleStateCells: true,
      runtimePath: options.runtimePath ?? '@memoized-dom/runtime/core'
    }),
    { emission: { identifiers: null, header: [] } }
  );

  prepareSemanticAnalysis(ctx, path, {
    ...desktopAnalysisProfile,
    normalizeComponents(context, sourcePath) {
      desktopAnalysisProfile.normalizeComponents?.(context, sourcePath);
      // Manifest discovery retains source aliases until linked contracts are
      // known. Final emission reuses the web target's binding-aware normalizer.
      normalizeComponentJsxValues(context);
    },
    install() {
      initializeGeneratedIdentifiers(ctx, program);
    }
  });

  if (planCompilerIntrinsics(ctx, path).length) {
    fail('Data/router intrinsics require their shared source-lowering phase');
  }

  walkAst<t.Node>(program, {
    enter(node) {
      if (isIntrinsicLifecycleCall(ctx, node, 'cleanup')) {
        fail('Cleanup requires shared lifecycle emission', node);
      }

      if (node.type === 'AwaitExpression') {
        fail('Await continuations require native execution-scope integration', node);
      }
    }
  });

  if (ctx.rootComponent === null && options.registerRoot !== false) {
    if (ctx.compPaths.has('App')) {
      ctx.rootComponent = 'App';
    } else if (ctx.compPaths.size === 1) {
      ctx.rootComponent = ctx.compPaths.keys().next().value!;
    } else if (ctx.compPaths.size > 1) {
      fail('Multiple components require an identified application root');
    }
  }

  if (ctx.computeds.size || ctx.moduleControlFlow.length) {
    fail('Module derivations require shared replay emission');
  }

  if (ctx.externalReactiveBindings.size || ctx.usesTransparentData) {
    fail('External sources require subscription emission');
  }

  if (ctx.moduleEffects.length) {
    fail('Module effects require shared lifecycle emission');
  }

  if ([...ctx.state.values()].includes('store')) {
    fail('Store methods require shared guarded-publication emission');
  }

  if (planModuleCallbacks(ctx, path, { includeComponentSetup: true }).retained.length) {
    fail('Retained callbacks require shared execution-scope emission');
  }

  for (const local of ctx.state.keys()) {
    const binding = astBindingAt(ctx, program, local);
    const declaration = binding === undefined ? null : variableDeclaratorFor(ctx, binding);
    const initial = declaration?.init == null ? null : unwrapTypeExpression(declaration.init);

    if (initial && (b.isObjectExpression(initial) || b.isArrayExpression(initial))) {
      fail('Store methods require shared guarded-publication emission', initial);
    }
  }

  walkAst<t.Node>(program, {
    enter(node) {
      if (!b.isCallExpression(node) || !b.isMemberExpression(node.callee)) {
        return;
      }

      const receiver = memberRootName(node.callee);

      if (receiver === null || !ctx.state.has(receiver)) {
        return;
      }

      const binding = astBindingAt(ctx, node, receiver);

      if (binding?.scope.isProgramScope) {
        fail('Calls on reactive receivers require shared guarded-publication emission', node);
      }
    }
  });

  const nativeId = generatedIdentifier(ctx, 'native');
  const facts = planExpressionSources(ctx);
  const readers = planAccessReaders(ctx);
  const renderPlan = planComponentRendering(ctx.compPaths, {
    callbacks: new Map(
      [...ctx.compPaths].map(([name, component]) => [
        name,
        planComponentCallbacks(ctx, name, component),
      ]),
    ),
    expressionSources: facts,
    pullPlans: planComponentPulls(ctx),
    placements: planComponentPlacements(ctx),
    regionReplays: planRegionReplays(ctx),
    listSites: planComponentListSites(ctx),
    renderCallbackProps: new Map(
      [...ctx.componentProps].map(([name, props]) => [
        name,
        [...props.renderCallbacks],
      ]),
    ),
  });
  const renderedByName = new Map(
    renderPlan.components.map(component => [component.name, component]),
  );

  const prepared: {
    name: string;
    plans: readonly (NativeTemplatePlan | null)[];
    returns: (typeof renderPlan.components)[number]['returns'];
  }[] = [];
  const slotReplayReaders = new Map<string, Set<string>>();
  const tableSites: Array<{
    readonly body: t.BlockStatement;
    readonly marker: t.BlockStatement;
  }> = [];

  for (const component of renderPlan.components) {
    const { name } = component;

    if (component.source.node.async) {
      fail('This emission phase requires synchronous components', component.source.node);
    }

    if (ctx.instanceState.get(name)?.size) {
      fail('Instance writes require shared guarded-publication emission', component.source.node);
    }

    if (ctx.instanceDerivations.get(name)?.length || ctx.instanceControlFlow.get(name)?.length) {
      fail('Instance derivations require shared replay emission', component.source.node);
    }

    if (ctx.effects.get(name)?.length) {
      fail('Component effects require shared lifecycle emission', component.source.node);
    }

    if (ctx.volatileComponents.has(name)) {
      fail('Opaque pulls require shared pull-plan emission', component.source.node);
    }

    const { returns } = component;
    const branches = 'jsx' in returns
      ? [returns.jsx]
      : returns.branches;
    const plans = branches.map((jsx, index) => {
      if (jsx === null) {
        return null;
      }

      const key = 'jsx' in returns
        ? `${moduleId}#${name}`
        : `${moduleId}#${name}/$return[${index}]`;
      const plan = withTemplateRevision(lowerNativeTemplate({
        key,
        jsx,
        expressionSources: component.expressionSources,
        isForwarded: expression => isRenderPropReference(
          ctx, name, expression as unknown as BaseNode,
        ),
        fail,
      }));

      validateNativeTemplatePlan(plan, jsx, fail);
      return plan;
    });

    prepared.push({
      name,
      returns,
      plans,
    });
  }

  for (const component of prepared) {
    const renderedComponent = renderedByName.get(component.name)!;
    const node = (ctx.compPaths.get(component.name)!).node;
    const frame = generatedIdentifier(ctx, 'frame');
    const props = ctx.componentProps.get(component.name)!;
    const propsBox = props.params.length > 0
      ? generatedIdentifier(ctx, 'props')
      : null;

    node.params = [
      frame,
      ...(propsBox === null
        ? []
        : [b.assignmentPattern(cloneNode(propsBox), b.arrayExpression([]))]),
    ];

    const propSources = props.params.map((_, index) =>
      b.memberExpression(
        cloneNode(propsBox!),
        b.numericLiteral(index),
        true,
      ),
    );
    const propDeclaration = propsBox === null
      ? null
      : buildPropDeclaration(props, propSources);

    if (propDeclaration !== null) {
      node.body.body.unshift(propDeclaration);
    }

    // Content factories are emitted after shared reader planning. Keep one
    // insertion marker so every component installs the same finalized module
    // table, including native caller-replay destinations discovered by emission.
    const table = b.blockStatement([]);
    tableSites.push({ body: node.body, marker: table });
    const emission = {
      ctx,
      moduleId,
      component: renderedComponent,
      nativeId,
      conditionCount: { value: 0 },
      slotCount: { value: 0 },
      listPrefixes: new Map<string, number>(),
      prelude: [] as t.Statement[],
      slotReplayReaders,
      fail,
    };

    const evaluate = (plan: NativeTemplatePlan): t.ArrowFunctionExpression =>
      propsBox === null
        ? b.arrowFunctionExpression([], nativeEvaluation(plan))
        : b.arrowFunctionExpression(
            [],
            b.blockStatement([
              ...buildPropReplay(props, propSources),
              b.returnStatement(nativeEvaluation(plan)),
            ]),
          );
    const createPresentation = 'jsx' in component.returns
      ? emitNativeView(
          emission,
          component.plans[0]!,
          frame,
          evaluate(component.plans[0]!),
        )
      : b.callExpression(
          b.memberExpression(cloneNode(nativeId), b.identifier('createConditional')),
          [
            cloneNode(frame),
            propsBox === null
              ? cloneNode(component.returns.pick)
              : b.arrowFunctionExpression(
                  [],
                  b.blockStatement([
                    ...buildPropReplay(props, propSources),
                    b.returnStatement(
                      b.callExpression(cloneNode(component.returns.pick), []),
                    ),
                  ]),
                ),
            b.arrayExpression(component.plans.map((plan) => {
              if (plan === null) {
                return b.nullLiteral();
              }

              const branchFrame = generatedIdentifier(ctx, 'returnBranchFrame');

              return b.arrowFunctionExpression(
                [branchFrame],
                emitNativeView(
                  emission,
                  plan,
                  branchFrame,
                  evaluate(plan),
                ),
              );
            })),
          ],
        );

    const result: t.Statement[] = [];

    result.push(...emission.prelude);

    if (propsBox === null) {
      result.push(b.returnStatement(createPresentation));
    } else {
      const view = generatedIdentifier(ctx, 'view');

      result.push(
        b.variableDeclaration('const', [
          b.variableDeclarator(cloneNode(view), createPresentation),
        ]),
        b.expressionStatement(
          b.callExpression(
            b.memberExpression(cloneNode(nativeId), b.identifier('bindViewProps')),
            [cloneNode(view), cloneNode(propsBox)],
          ),
        ),
        b.returnStatement(cloneNode(view)),
      );
    }

    const original = component.returns;

    if ('statement' in original) {
      node.body.body = node.body.body.flatMap((statement) =>
        statement === original.statement
          ? [
              ...(table ? [table] : []),
              ...result,
            ]
          : [statement],
      );
    } else {
      node.body.body = [
        ...node.body.body.filter(statement => !original.statements.has(statement)),
        ...(table ? [table] : []),
        ...result,
      ];
    }
  }

  const nativeReaders = new Map(
    [...readers].map(([source, destinations]) => [source, new Set(destinations)]),
  );

  for (const [source, destinations] of slotReplayReaders) {
    let routed = nativeReaders.get(source);

    if (routed === undefined) {
      routed = new Set();
      nativeReaders.set(source, routed);
    }

    for (const destination of destinations) {
      routed.add(destination);
    }
  }

  for (const { body, marker } of tableSites) {
    const table = emitAccessTable(ctx, nativeReaders);
    body.body = body.body.flatMap(statement =>
      statement === marker ? (table === null ? [] : [table]) : [statement]);
  }

  liftModuleStateCells(ctx, path);

  // Root metadata joins the existing realm registry. The authored component
  // reference remains what mount receives; callers never supply a native frame.
  for (const component of prepared) {
    if (options.registerRoot === false || component.name !== ctx.rootComponent) {
      continue;
    }

    program.body.push(b.expressionStatement(b.callExpression(
      b.memberExpression(cloneNode(nativeId), b.identifier('registerNativeRoot')),
      [b.identifier(component.name), b.stringLiteral(ctx.rootId)]
    )));
  }

  walkAst<t.Node>(program, {
    enter(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        fail('JSX outside the emitted root requires a component source plan', node);
      }
    }
  });

  program.body.unshift(
    b.importDeclaration(
      [
        b.importNamespaceSpecifier(b.identifier(requireIdentifiers(ctx).runtimeId))
      ],
      b.stringLiteral(ctx.runtimePath)
    ),
    b.importDeclaration([b.importNamespaceSpecifier(nativeId)], b.stringLiteral(options.presentationPath ?? '@memoized-dom/desktop/internal-runtime')),
    ...ctx.emission.header
  );

  normalizeEstreeDialect(program);

  const output = printEstree(stripTypeScript(program), {
    comments: parsed.comments,
    sourceMapSource: moduleId,
    sourceMapContent: source
  });

  return {
    code: output.code,
    map: output.map,
    // The build adapter hands this to Vite's ordinary CSS pipeline. Raw CSS
    // must never bypass its plugins by entering the native template here.
    css: parsed.css,
    components: prepared.map((component) => component.name)
  };
}
