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
import { analyzeComponentReturns } from '../components/return-plan';
import { liftModuleStateCells, type CellEmissionContext } from '../cells';
import { emitAccessTable } from '../emission/access-table';
import { emitOrderedAttributes } from '../emission/attributes';

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
}

function evaluation(plan: NativeTemplatePlan): t.Expression {
  return b.arrayExpression(plan.steps.map((step) => {
    if (step.kind === 'region') {
      throw new Error('Structural capability must be checked before emission');
    }

    const value = step.kind === 'text'
      ? cloneNode(step.expression)
      : emitOrderedAttributes(step.plan);

    return b.objectExpression([
      b.objectProperty(b.identifier('kind'), b.stringLiteral(step.kind)),
      b.objectProperty(b.identifier('source'), b.numericLiteral(step.source)),
      b.objectProperty(b.identifier('value'), value)
    ]);
  }));
}

export function compileDesktop(source: string, options: DesktopCompileOptions = {}) {
  const moduleId = options.moduleId ?? './App.tsx';
  const parsed = parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend, source, { filename: moduleId });
  const program = parsed.program as t.Program;

  const fail = (message: string, at: t.Node = program): never => {
    throw compilerError('memo-dom desktop: ' + message, moduleId, at);
  };

  if (parsed.css) {
    fail('Stylesheet emission requires native CSS/asset integration');
  }
  for (const statement of program.body) {
    if (b.isImportDeclaration(statement) && statement.source.value.endsWith('.css')) {
      fail('Stylesheet imports require native CSS/asset integration', statement);
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

  if (ctx.compPaths.size > 1) {
    fail('Component composition requires the structural emission phase');
  }
  if (ctx.rootComponent === null && ctx.compPaths.size === 1) {
    ctx.rootComponent = ctx.compPaths.keys().next().value!;
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

  const prepared: {
    name: string;
    plan: NativeTemplatePlan;
    returns: ReturnType<typeof analyzeComponentReturns>
   }[] = [];

  for (const [name, component] of ctx.compPaths) {
    if (component.node.async || component.node.params.length) {
      fail('This emission phase requires a synchronous root without props', component.node);
    }

    if (ctx.instanceState.get(name)?.size) {
      fail('Instance writes require shared guarded-publication emission', component.node);
    }

    if (ctx.instanceDerivations.get(name)?.length || ctx.instanceControlFlow.get(name)?.length) {
      fail('Instance derivations require shared replay emission', component.node);
    }

    if (ctx.effects.get(name)?.length) {
      fail('Component effects require shared lifecycle emission', component.node);
    }

    if (ctx.volatileComponents.has(name)) {
      fail('Opaque pulls require shared pull-plan emission', component.node);
    }

    const returns = analyzeComponentReturns(component, name);

    const jsx = 'jsx' in returns
      ? returns.jsx
      : fail('Branch returns require structural emission', component.node);

    const plan = lowerNativeTemplate({
      key: moduleId + '#' + name,
      jsx,
      expressionSources: facts.get(name)!,
      isForwarded: () => false,
      fail
    });

    if (plan.refs.length) {
      fail('Refs require native handle capability emission', jsx);
    }

    if (plan.steps.some((step) => step.kind === 'region')) {
      fail('Structural content requires region emission', jsx);
    }

    const revision = createHash('sha256').update(JSON.stringify(plan.template.nodes)).digest('hex');

    prepared.push({
      name,
      returns,
      plan: {
        ...plan,
        template: { ...plan.template, key: plan.template.key + ':' + revision }
      }
    });
  }

  for (const component of prepared) {
    const node = (ctx.compPaths.get(component.name)!).node;
    const frame = generatedIdentifier(ctx, 'frame');

    node.params = [frame];

    const table = emitAccessTable(ctx, readers);

    const result = b.returnStatement(b.callExpression(b.memberExpression(cloneNode(nativeId), b.identifier('createView')), [
      cloneNode(frame),
      valueToNode(component.plan.template) as t.Expression,
      b.arrowFunctionExpression([], evaluation(component.plan))
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
    components: prepared.map((component) => component.name)
  };
}
