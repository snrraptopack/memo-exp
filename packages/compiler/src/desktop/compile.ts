/** Desktop lowering: retained scene destinations driven by shared semantic plans. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { parseWithEstreeFrontendOrThrow, type EstreeFrontend } from '../ast/parser';
import { memoizedEstreeFrontend } from '../ast/tsrx/frontend';
import { printEstree } from '../ast/printer';
import { stripTypeScript } from '../ast/strip-typescript';
import { walkAst } from '../ast/walk';
import { normalizeEstreeDialect, unwrapTypeExpression } from '../ast/normalize';
import { createAnalysisCtx, type ProgramPath, type LinkedImport } from '../context/model';
import { canonicalStateKey } from '../context';
import { refreshAstAnalysis } from '../context/ast';
import { normalizeComponentDeclarations } from '../components/declarations';
import { scanComponents, scanModuleState, validateLinkedImports } from '../analysis/module-scan';
import {
  scanInstanceState,
  scanInstanceDerivations,
  excludeRefBindings,
} from '../analysis/instance';
import { planComponentCallbacks } from '../planning/component-callbacks';
import { planExpressionSources } from '../planning/expression-sources';
import { compilerError } from '../errors';
import { lowerDesktopScene } from './lower-scene';
import { emitDesktopScene } from './emit-scene';
import { desktopCssRules } from './css';
import { desktopProps } from './components';
import { desktopComponentImports, type DesktopModuleReader } from './imports';
import { analyzeMapSite, matchMapCall } from '../lists';
import { prepareDesktopListSources } from './lists';
import { collectReads } from '../analysis/read-collection';
import { scanComputeds, analyzeComputed } from '../analysis/computed';
import { scanModuleControlFlow } from '../module-control-flow';
import { planModuleCallbacks } from '../planning/module-callbacks';
import { routeDesktopModuleWrites } from './write-routing';
import { desktopAccessReaders } from './access';
import { emitModuleComputeds } from '../emission/computeds';
import { valueExpression } from './lower-scene';
import { planHandlerWrites } from '../handlers/analyze';
import {
  scanInstanceControlFlow,
  finalizeInstancePreludes,
} from '../analysis/instance-control-flow';
import { emitModuleControlFlow } from '../emission/control-flow';
import { desktopPrelude } from './prelude';
import { liftModuleStateCells } from '../cells';
import { scanEffects } from '../effects/discovery';
import { isIntrinsicLifecycleCall, planCompilerIntrinsics } from '../intrinsics';
import { compileRefValue } from '../emission/refs';
import { desktopLifecycle, desktopEffectRegistration } from './lifecycle';

export interface DesktopCompileOptions {
  /** Build adapters also compile state, helper, and component-free utility modules. */
  allowComponentFree?: boolean;
  moduleId?: string;
  runtimePath?: string;
  frontend?: EstreeFrontend;
  /** Build adapter resolves ordinary side-effect CSS imports. */
  readStylesheet?: (specifier: string, importer?: string) => string;
  /** Resolve authored component modules; core discovery verifies exported identities. */
  readModule?: DesktopModuleReader;
  /** Graph builds supply canonical state identities and fixed-point helper effects. */
  linkedImports?: Record<string, LinkedImport>;
  coreRuntimePath?: string;
  /** Only this graph's module entities activate in its desktop application. */
  activationModules?: readonly string[];
}

export interface DesktopCompiledSource {
  readonly code: string;
  readonly components: readonly string[];
}

/** Reuse core parsing, lexical state discovery, callback effects, and expression facts. */
export function compileDesktop(
  source: string,
  options: DesktopCompileOptions = {},
): DesktopCompiledSource {
  const moduleId = options.moduleId ?? './desktop.tsx';
  const parsed = parseWithEstreeFrontendOrThrow(
    options.frontend ?? memoizedEstreeFrontend,
    source,
    { filename: moduleId, sourceType: 'module' },
  );
  const program = parsed.program as t.Program;
  const fail: (message: string, at?: t.Node) => never = (message, at = program) => {
    throw compilerError(`memo-dom desktop: ${message}`, moduleId, at);
  };
  let css = parsed.css ?? '';
  program.body = program.body.filter((statement) => {
    if (!b.isImportDeclaration(statement) || !statement.source.value.endsWith('.css')) return true;
    if (statement.specifiers.length) fail('CSS module bindings are not implemented', statement);
    if (!options.readStylesheet) fail('CSS imports require a desktop build adapter', statement);
    css += '\n' + options.readStylesheet!(statement.source.value);
    return false;
  });
  const stylesheets = css ? desktopCssRules(css, moduleId) : [];
  normalizeEstreeDialect(program);
  const path: ProgramPath = {
    node: program,
    buildCodeFrameError: (message, at) => compilerError(message, moduleId, at),
  };
  normalizeComponentDeclarations(path);
  const linkedImports =
    options.linkedImports ??
    desktopComponentImports(
      program,
      moduleId,
      options.frontend ?? memoizedEstreeFrontend,
      options.readModule,
    );
  const ctx = createAnalysisCtx({
    moduleId,
    rootId: 'Desktop',
    linkedImports,
    moduleStateCells: true,
  });
  refreshAstAnalysis(ctx, program);
  planCompilerIntrinsics(ctx, path);
  validateLinkedImports(ctx, path);
  scanModuleState(ctx, path);
  scanComponents(ctx, path);
  if (!ctx.compPaths.size && options.allowComponentFree) {
    if (stylesheets.length)
      fail('component-free CSS imports require a desktop stylesheet linking contract');
    walkAst<t.Node>(program, {
      enter(node) {
        if (b.isJSXElement(node) || b.isJSXFragment(node))
          fail('JSX outside a desktop component is not implemented', node);
      },
    });
  }
  scanInstanceState(ctx);
  excludeRefBindings(ctx);
  scanComputeds(ctx, path);
  scanModuleControlFlow(ctx, path, analyzeComputed);
  scanInstanceDerivations(ctx);
  scanInstanceControlFlow(ctx);
  finalizeInstancePreludes(ctx);
  scanEffects(ctx, path);
  for (const component of ctx.compPaths.values()) {
    const last = component.node.body.body.at(-1);
    if (last && b.isReturnStatement(last) && last.argument)
      prepareDesktopListSources(last.argument, ctx);
  }
  collectReads(ctx);
  const readers = desktopAccessReaders(ctx);
  const activationModules = options.activationModules ?? [
    ...new Set([
      moduleId,
      ...Object.keys(readers).map((key) => key.slice(0, key.lastIndexOf('#'))),
    ]),
  ];
  const moduleCallbacks = planModuleCallbacks(ctx, path);
  const callbacks = new Map(
    [...ctx.compPaths].map(([name, component]) => [
      name,
      planComponentCallbacks(ctx, name, component),
    ]),
  );
  const expressionFacts = planExpressionSources(ctx);
  const used = new Set<string>();
  walkAst<t.Node>(program, {
    enter(node) {
      if (b.isIdentifier(node)) used.add(node.name);
    },
  });
  const fresh = (base: string): t.Identifier => {
    let name = base;
    for (let suffix = 1; used.has(name); suffix++) name = `${base}${suffix}`;
    used.add(name);
    return b.identifier(name);
  };
  const mount = fresh('__desktopMount');
  const instrument = fresh('__desktopEvent');
  const define = fresh('__desktopDefine');
  const scope = fresh('__desktopScope');
  const core = fresh('__desktopCore');
  const defineModule = fresh('__desktopModule');
  const affected = fresh('__desktopAffected');
  let coreUsed = false;
  const instrumented = new Set<t.Node>();
  const routeWrites = (plan: ReturnType<typeof planHandlerWrites>, local?: t.Identifier): void => {
    if (instrumented.has(plan.original)) return;
    instrumented.add(plan.original);
    coreUsed = routeDesktopModuleWrites(ctx, plan, core, fresh, local) || coreUsed;
  };
  for (const helper of ctx.helpers.values()) {
    const plan = moduleCallbacks.writesFor(helper.node, true);
    routeWrites(plan);
  }
  for (const site of moduleCallbacks.retained)
    routeWrites(moduleCallbacks.writesFor(site.target, true));
  let eventsUsed = false;
  let scopesUsed = false;
  const templates: t.Statement[] = [];
  const definitions: t.Statement[] = [];

  for (const [name, component] of ctx.compPaths) {
    const fn = component.node;
    if (fn.async || fn.generator) fail('components must be synchronous', fn);
    const statements = fn.body.body;
    const last = statements.at(-1);
    if (!last || !b.isReturnStatement(last) || !last.argument)
      fail('components need a final fixed JSX return', fn);
    const root = unwrapTypeExpression(last.argument);
    if (
      !b.isJSXElement(root) &&
      !b.isJSXFragment(root) &&
      !b.isConditionalExpression(root) &&
      !b.isLogicalExpression(root) &&
      !matchMapCall(root)
    )
      fail('dynamic component roots are not implemented yet', root);
    for (const statement of statements.slice(0, -1)) {
      if (b.isReturnStatement(statement))
        fail('early component returns are not implemented yet', statement);
      walkAst<t.Node>(statement, {
        enter(node) {
          if (b.isJSXElement(node) || b.isJSXFragment(node))
            fail('nested component factories are not implemented yet', node);
          if (node.type === 'YieldExpression')
            fail('generator callbacks require iterator lifecycle instrumentation', node);
        },
      });
    }
    const prepare = desktopPrelude(ctx, name, statements, fresh('__desktopSources'), affected);
    const instance = fresh('__desktopOwner');
    const notify = fresh('__desktopNotify');
    const changedSources = fresh('__desktopChangedSources');
    // Retained callbacks need the same routing as callbacks invoked by events.
    // Capture first, because adopting an instrumented outer body replaces nodes.
    const retained = [...statements];
    const retainedPlans: ReturnType<typeof planHandlerWrites>[] = [];
    for (const statement of retained)
      walkAst(statement, {
        enter(node) {
          if (!b.isFunction(node)) return;
          const value = b.isFunctionDeclaration(node)
            ? node.id && b.identifier(node.id.name)
            : node;
          if (!value) return;
          const callback = callbacks.get(name)!.forValue(value);
          if (callback) retainedPlans.push(callback.writesFor());
        },
      });
    for (const plan of retainedPlans) routeWrites(plan, notify);
    const lifecycle = desktopLifecycle(ctx, name, component, {
      owner: instance,
      fresh,
      runtime: (method) => {
        coreUsed = true;
        return b.memberExpression(core, b.identifier(method));
      },
      instrument(expression) {
        const callback = callbacks.get(name)!.forValue(expression, true);
        if (callback) routeWrites(callback.writesFor(), notify);
      },
    });
    const listPrefixes = new Map<string, number>();
    prepareDesktopListSources(root, ctx);
    const scene = lowerDesktopScene(root, {
      callbacks: callbacks.get(name)!,
      sources: expressionFacts.get(name)!,
      instrument,
      scope,
      fail,
      fresh,
      components: ctx.componentProps,
      imports: ctx.importedComponents,
      routeWrites: (plan) => routeWrites(plan, notify),
      refValue: (expression) =>
        compileRefValue(ctx, component, name, expression, {
          fresh,
          runtime: (method) => {
            coreUsed = true;
            return b.memberExpression(core, b.identifier(method));
          },
        }),
      moduleCallback: (expression) => {
        if (
          !b.isIdentifier(expression) ||
          (!ctx.helpers.has(expression.name) && !ctx.importedFunctions.has(expression.name))
        )
          return null;
        const event = fresh('__desktopEventValue');
        const target = b.arrowFunctionExpression([event], b.callExpression(expression, [event]));
        return { target, helpers: [], writesFor: () => planHandlerWrites(ctx, target, null) };
      },
      listSite: (call, parentRow) => analyzeMapSite(ctx, call, path, name, listPrefixes, parentRow),
    });
    const props = desktopProps(ctx.componentProps.get(name)!, fresh, fail);
    fn.params = props.params;
    const emitted = emitDesktopScene(scene, {
      id: `${moduleId}#${name}`,
      stylesheets,
      stylesheet: stylesheets.length ? moduleId : undefined,
      modules: activationModules,
      mount,
      define,
      fresh,
      templates,
      receive: props.receive,
      prepare,
      lifecycle: lifecycle.properties,
    });
    eventsUsed ||= emitted.eventsUsed;
    scopesUsed ||= emitted.scopesUsed;
    definitions.push(
      b.expressionStatement(
        b.callExpression(define, [
          b.identifier(name),
          emitted.template,
          b.arrowFunctionExpression([], b.arrayExpression(emitted.dependencies.map(b.identifier))),
          b.arrayExpression(emitted.fragmentTemplates),
          valueExpression(activationModules),
        ]),
      ),
    );
    fn.body.body = [
      b.variableDeclaration('let', [b.variableDeclarator(instance)]),
      b.variableDeclaration('const', [
        b.variableDeclarator(
          notify,
          b.arrowFunctionExpression(
            [changedSources],
            b.blockStatement([
              b.ifStatement(
                instance,
                b.expressionStatement(
                  b.callExpression(b.memberExpression(instance, b.identifier('invalidate')), [
                    changedSources,
                  ]),
                ),
              ),
            ]),
          ),
        ),
      ]),
      ...lifecycle.setup,
      ...props.setup,
      ...statements.slice(0, -1).filter((statement) => !lifecycle.statements.has(statement)),
      ...emitted.setup,
      b.expressionStatement(b.assignmentExpression('=', instance, emitted.mount)),
      b.returnStatement(instance),
    ];
  }
  if (!ctx.compPaths.size && !options.allowComponentFree) fail('no desktop components were found');
  const initializers: t.Statement[] = [];
  const moduleEffectStatements = new Set(ctx.moduleEffects.map((site) => site.statement));
  program.body = program.body.filter((statement) => !moduleEffectStatements.has(statement));
  for (const site of ctx.moduleEffects)
    initializers.push(
      desktopEffectRegistration(site, b.stringLiteral('Desktop'), b.stringLiteral(site.entityId), {
        fresh,
        runtime: (method) => b.memberExpression(core, b.identifier(method)),
        instrument(expression) {
          if (b.isArrowFunctionExpression(expression) || b.isFunctionExpression(expression)) {
            routeWrites(planHandlerWrites(ctx, expression, null, undefined, false, true));
          }
        },
      }),
    );
  // Module cleanup runs once per application activation, in its core scope.
  program.body = program.body.filter((statement) => {
    if (
      !b.isExpressionStatement(statement) ||
      !b.isCallExpression(statement.expression) ||
      !isIntrinsicLifecycleCall(ctx, statement.expression, 'cleanup')
    )
      return true;
    initializers.push(
      b.expressionStatement(
        b.callExpression(b.memberExpression(core, b.identifier('cleanup')), [
          b.stringLiteral('Desktop'),
          ...statement.expression.arguments,
        ]),
      ),
    );
    return false;
  });
  emitModuleComputeds(ctx, program, {
    fresh,
    runtime: (name) => b.memberExpression(core, b.identifier(name)),
    writes: (keys) => valueExpression(keys.map((key) => canonicalStateKey(ctx, key))),
    defer: (statements) => initializers.push(...statements),
    parent: b.stringLiteral('Desktop'),
  });
  coreUsed ||= initializers.length > 0;
  emitModuleControlFlow(ctx, program, {
    initialize: true,
    fresh,
    runtime: (name) => b.memberExpression(core, b.identifier(name)),
    writes: (keys) => valueExpression(keys.map((key) => canonicalStateKey(ctx, key))),
    defer: (statements) => initializers.push(...statements),
    parent: b.stringLiteral('Desktop'),
  });
  coreUsed ||= initializers.length > 0;
  const hasModule = Object.keys(readers).length > 0 || initializers.length > 0;
  const imports: t.Statement[] = [];
  if (coreUsed)
    imports.push(
      b.importDeclaration(
        [b.importNamespaceSpecifier(core)],
        b.stringLiteral(options.coreRuntimePath ?? '@memoized-dom/runtime/core'),
      ),
    );
  if (ctx.compPaths.size || hasModule)
    imports.push(
      b.importDeclaration(
        [
          ...(hasModule
            ? [b.importSpecifier(defineModule, b.identifier('defineSceneModule'))]
            : []),
          ...(ctx.compPaths.size
            ? [
                b.importSpecifier(mount, b.identifier('mountScene')),
                b.importSpecifier(define, b.identifier('defineSceneComponent')),
                b.importSpecifier(affected, b.identifier('sceneSourcesChanged')),
                ...(eventsUsed ? [b.importSpecifier(instrument, b.identifier('sceneEvent'))] : []),
                ...(scopesUsed ? [b.importSpecifier(scope, b.identifier('sceneScope'))] : []),
              ]
            : []),
        ],
        b.stringLiteral(options.runtimePath ?? '@memoized-dom/desktop'),
      ),
    );
  program.body.unshift(...imports, ...templates);
  if (hasModule)
    program.body.push(
      b.expressionStatement(
        b.callExpression(defineModule, [
          b.stringLiteral(moduleId),
          valueExpression({ readers }),
          b.arrowFunctionExpression([], b.blockStatement(initializers)),
        ]),
      ),
    );
  program.body.push(...definitions);
  walkAst<t.Node>(program, {
    enter(node) {
      if (!b.isCallExpression(node)) return;
      if (isIntrinsicLifecycleCall(ctx, node, 'effect'))
        fail('$effect() requires component or module ownership', node);
      if (isIntrinsicLifecycleCall(ctx, node, 'cleanup'))
        fail('$cleanup() requires component or direct module ownership', node);
    },
  });
  const cellHeader: t.Statement[] = [];
  liftModuleStateCells(ctx, path, {
    fresh,
    runtime: (name) => {
      coreUsed = true;
      return b.memberExpression(core, b.identifier(name));
    },
    header: cellHeader,
    includeDerived: true,
    preserveExports: true,
    valueWrites: true,
  });
  program.body.unshift(...cellHeader);
  if (
    coreUsed &&
    !imports.some(
      (statement) =>
        b.isImportDeclaration(statement) &&
        statement.specifiers.some((specifier) => specifier.type === 'ImportNamespaceSpecifier'),
    )
  ) {
    program.body.unshift(
      b.importDeclaration(
        [b.importNamespaceSpecifier(core)],
        b.stringLiteral(options.coreRuntimePath ?? '@memoized-dom/runtime/core'),
      ),
    );
  }
  return {
    code: printEstree(stripTypeScript(program), { comments: parsed.comments }).code,
    components: [...ctx.compPaths.keys()],
  };
}
