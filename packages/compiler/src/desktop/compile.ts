/** First executable backend: fixed hosts and shared module-cell publication. */
import { createHash } from 'node:crypto';

import * as b from '../ast/factory';
import type * as t from '../ast/compiler-types';

import {
  cloneNode,
  memoizedEstreeFrontend,
  normalizeEstreeDialect,
  parseWithEstreeFrontendOrThrow,
  printEstree,
  stripTypeScript,
  valueToNode,
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
import { liftModuleStateCells, type CellEmissionContext } from '../cells';
import { emitAccessTable } from '../emission/access-table';
import { emitOrderedAttributes } from '../emission/attributes';
import { planOrderedAttributes } from '../jsx/attributes';
import {
  callPropsFromObject,
  orderCallProps,
} from '../components/call-props';
import { runtimeParameter } from '../components/props';

import {
  generatedIdentifier,
  initializeGeneratedIdentifiers,
  requireIdentifiers
} from '../emission/identifiers';

import { compilerError } from '../errors';
import { isIntrinsicLifecycleCall, planCompilerIntrinsics } from '../intrinsics';
import { planModuleCallbacks } from '../planning/module-callbacks';
import { memberRootName } from '../context';
import { lowerNativeTemplate } from './template';
import type { NativeTemplatePlan } from './template-plan';

export interface DesktopCompileOptions extends AnalysisOptions {
  readonly frontend?: EstreeFrontend;
  /** Compiler-private presentation adapter selected by the desktop build. */
  readonly presentationPath?: string
  readonly stylesheetImports?: 'preserve';
}

function evaluation(plan: NativeTemplatePlan): t.Expression {
  return b.arrayExpression(plan.steps.flatMap((step) => {
    if (step.kind === 'region') {
      return [];
    }

    const value = step.kind === 'text'
      ? cloneNode(step.expression)
      : emitOrderedAttributes(step.plan);

    return [b.objectExpression([
      b.objectProperty(b.identifier('kind'), b.stringLiteral(step.kind)),
      b.objectProperty(b.identifier('source'), b.numericLiteral(step.source)),
      b.objectProperty(b.identifier('value'), value)
    ])];
  }));
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

  if (ctx.rootComponent === null) {
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

  const prepared: {
    name: string;
    plan: NativeTemplatePlan;
    returns: (typeof renderPlan.components)[number]['returns'];
  }[] = [];

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

    const jsx = 'jsx' in returns
      ? returns.jsx
      : fail('Branch returns require structural emission', component.source.node);

    const plan = lowerNativeTemplate({
      key: moduleId + '#' + name,
      jsx,
      expressionSources: component.expressionSources,
      isForwarded: () => false,
      fail
    });

    if (plan.refs.length) {
      fail('Refs require native handle capability emission', jsx);
    }

    for (const event of plan.events) {
      if (event.name !== 'onClick' && event.name !== 'onClickCapture') {
        fail(`Event ${event.name} requires native platform dispatch integration`, jsx);
      }
    }

    for (const step of plan.steps) {
      if (step.kind === 'region' && step.content.type !== 'component') {
        fail('Lists, conditions and forwarded children require structural replay emission', jsx);
      }
    }

    const revision = createHash('sha256').update(JSON.stringify(plan.template.nodes)).digest('hex');

    prepared.push({
      name,
      returns,
      plan: {
        ...plan,
        template: {
          ...plan.template,
          key: plan.template.key + ':' + revision,
        },
      },
    });
  }

  for (const component of prepared) {
    const node = (ctx.compPaths.get(component.name)!).node;
    const frame = generatedIdentifier(ctx, 'frame');
    const props = ctx.componentProps.get(component.name)!;

    node.params = [frame, ...props.params.map(runtimeParameter)];

    const table = emitAccessTable(ctx, readers);
    const childCounts = new Map<string, number>();
    const children = component.plan.steps.flatMap((step) => {
      if (step.kind !== 'region') {
        return [];
      }

      if (step.content.type !== 'component') {
        throw new Error('Structural capability must be checked before emission');
      }

      const element = step.content.node;
      const opening = element.openingElement;

      if (!b.isJSXIdentifier(opening.name)) {
        fail('Member and dynamic component tags require shared dynamic-tag emission', opening.name);
      }

      const tag = (opening.name as t.JSXIdentifier).name;

      if (!ctx.compPaths.has(tag) && !ctx.importedComponents.has(tag)) {
        fail(`Component <${tag}> is not resolved by the application graph`, opening.name);
      }

      const seen = childCounts.get(tag) ?? 0;
      childCounts.set(tag, seen + 1);
      const segment = seen === 0 ? tag : `${tag}[${seen}]`;

      if (element.children.some((child) =>
        !b.isJSXText(child) || child.value.trim().length > 0)) {
        fail('Component children require forwarded-content region emission', element);
      }

      const attributes = planOrderedAttributes(opening.attributes, {
        skipKey: true,
        fail: message => fail(message, opening),
      });

      for (const entry of attributes.entries) {
        const sources = facts.get(component.name)!.sourcesFor(entry.value);

        if (sources === null || sources.length > 0) {
          fail('Reactive component props require accepted prop replay emission', entry.value);
        }
      }

      const spreads = attributes.entries.some(entry => entry.type === 'spread');
      const arguments_ = spreads
        ? callPropsFromObject(ctx, tag, emitOrderedAttributes(attributes))
        : orderCallProps(
            ctx,
            tag,
            attributes.entries.map((entry) => {
              if (entry.type === 'spread') {
                throw new Error('Spread entries are handled by the object path');
              }

              return { name: entry.name, value: cloneNode(entry.value) };
            }),
          );
      const childFrame = generatedIdentifier(ctx, 'childFrame');
      const create = b.arrowFunctionExpression(
        [childFrame],
        b.callExpression(b.identifier(tag), [
          cloneNode(childFrame),
          ...arguments_,
        ]),
      );

      return [
        b.callExpression(
          b.memberExpression(cloneNode(nativeId), b.identifier('child')),
          [b.stringLiteral(segment), b.numericLiteral(step.source), create],
        ),
      ];
    });

    const result = b.returnStatement(b.callExpression(b.memberExpression(cloneNode(nativeId), b.identifier('createView')), [
      cloneNode(frame),
      valueToNode(component.plan.template) as t.Expression,
      b.arrowFunctionExpression([], evaluation(component.plan)),
      b.arrayExpression(children),
    ]));

    const original = component.returns;

    if (!('statement' in original)) {
      throw new Error('Missing direct return');
    }

    node.body.body = node.body.body.flatMap((statement) => statement === original.statement ? [...table ? [table] : [], result] : [statement]);
  }

  liftModuleStateCells(ctx, path);

  // Root metadata joins the existing realm registry. The authored component
  // reference remains what mount receives; callers never supply a native frame.
  for (const component of prepared) {
    if (component.name !== ctx.rootComponent) {
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
