/** Desktop lowering: retained component regions with synchronous lexical state. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { parseWithEstreeFrontendOrThrow, type EstreeFrontend } from '../ast/parser';
import { memoizedEstreeFrontend } from '../ast/tsrx/frontend';
import { printEstree } from '../ast/printer';
import { stripTypeScript } from '../ast/strip-typescript';
import { walkAst } from '../ast/walk';
import { normalizeEstreeDialect, unwrapTypeExpression } from '../ast/normalize';
import { createAnalysisCtx, type ProgramPath } from '../context/model';
import { refreshAstAnalysis, nodeHasJsx } from '../context/ast';
import { normalizeComponentDeclarations } from '../components/declarations';
import { scanComponents, scanModuleState, validateLinkedImports } from '../analysis/module-scan';
import { scanInstanceState, scanInstanceDerivations } from '../analysis/instance';
import { planComponentCallbacks } from '../planning/component-callbacks';
import { planExpressionSources } from '../planning/expression-sources';
import { compilerError } from '../errors';
import { lowerDesktopScene, valueExpression } from './lower-scene';
import { desktopCssRules } from './css';
import { desktopProps } from './components';
import { desktopComponentImports, type DesktopModuleReader } from './imports';
import { analyzeMapSite, matchMapCall } from '../lists';

export interface DesktopCompileOptions {
  /** Build adapters may load component-free TSX utilities without a runtime import. */
  allowComponentFree?: boolean;
  moduleId?: string;
  runtimePath?: string;
  frontend?: EstreeFrontend;
  /** Build adapter resolves ordinary side-effect CSS imports. */
  readStylesheet?: (specifier: string) => string;
  /** Resolve authored component modules; core discovery verifies exported identities. */
  readModule?: DesktopModuleReader;
}

export interface DesktopCompiledSource {
  readonly code: string;
  readonly components: readonly string[];
}

/** Reuse core parsing, lexical state discovery, callback effects, and expression facts. */
export function compileDesktop(source: string, options: DesktopCompileOptions = {}): DesktopCompiledSource {
  const moduleId = options.moduleId ?? './desktop.tsx';
  const parsed = parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend, source,
    { filename: moduleId, sourceType: 'module' });
  const program = parsed.program as t.Program;
  const fail: (message: string, at?: t.Node) => never = (message, at = program) => {
    throw compilerError(`memo-dom desktop: ${message}`, moduleId, at);
  };
  let css = parsed.css ?? '';
  program.body = program.body.filter(statement => {
    if (!b.isImportDeclaration(statement) || !statement.source.value.endsWith('.css')) return true;
    if (statement.specifiers.length) fail('CSS module bindings are not implemented', statement);
    if (!options.readStylesheet) fail('CSS imports require a desktop build adapter', statement);
    css += '\n' + options.readStylesheet!(statement.source.value);
    return false;
  });
  const stylesheets = css ? desktopCssRules(css, moduleId) : [];
  normalizeEstreeDialect(program);
  const path: ProgramPath = { node: program, buildCodeFrameError: (message, at) => compilerError(message, moduleId, at) };
  normalizeComponentDeclarations(path);
  if (options.allowComponentFree && !nodeHasJsx(program)) {
    if (stylesheets.length) fail('component-free CSS imports require a desktop stylesheet linking contract');
    return { code: printEstree(stripTypeScript(program), { comments: parsed.comments }).code, components: [] };
  }
  const linkedImports = desktopComponentImports(program, moduleId, options.frontend ?? memoizedEstreeFrontend, options.readModule);
  const ctx = createAnalysisCtx({ moduleId, linkedImports });
  refreshAstAnalysis(ctx, program);
  validateLinkedImports(ctx, path);
  scanModuleState(ctx, path);
  scanComponents(ctx, path);
  if (!ctx.compPaths.size && options.allowComponentFree) {
    walkAst<t.Node>(program, { enter(node) {
      if (b.isJSXElement(node) || b.isJSXFragment(node)) fail('JSX outside a desktop component is not implemented', node);
    } });
    return { code: printEstree(stripTypeScript(program), { comments: parsed.comments }).code, components: [] };
  }
  scanInstanceState(ctx);
  scanInstanceDerivations(ctx);
  if (ctx.state.size) fail('reactive module state requires desktop graph scheduling, which is not implemented yet');
  const expressionFacts = planExpressionSources(ctx);
  const used = new Set<string>();
  walkAst<t.Node>(program, { enter(node) { if (b.isIdentifier(node)) used.add(node.name); } });
  const fresh = (base: string): t.Identifier => {
    let name = base;
    for (let suffix = 1; used.has(name); suffix++) name = `${base}${suffix}`;
    used.add(name);
    return b.identifier(name);
  };
  const mount = fresh('__desktopMount');
  const instrument = fresh('__desktopEvent');
  const define = fresh('__desktopDefine');
  let eventsUsed = false;
  const templates: t.Statement[] = [];
  const definitions: t.Statement[] = [];

  for (const [name, component] of ctx.compPaths) {
    const fn = component.node;
    if (fn.async || fn.generator) fail('components must be synchronous', fn);
    const statements = fn.body.body;
    const last = statements.at(-1);
    if (!last || !b.isReturnStatement(last) || !last.argument) fail('components need a final fixed JSX return', fn);
    const root = unwrapTypeExpression(last.argument);
    if (!b.isJSXElement(root) && !b.isJSXFragment(root) && !b.isConditionalExpression(root) && !b.isLogicalExpression(root) && !matchMapCall(root)) fail('dynamic component roots are not implemented yet', root);
    for (const statement of statements.slice(0, -1)) {
      if (b.isReturnStatement(statement)) fail('early component returns are not implemented yet', statement);
      walkAst<t.Node>(statement, { enter(node) {
        if (b.isJSXElement(node) || b.isJSXFragment(node)) fail('nested component factories are not implemented yet', node);
        if (node.type === 'AwaitExpression' || node.type === 'YieldExpression') fail('asynchronous callbacks are not implemented yet', node);
      } });
    }
    if (ctx.instanceDerivations.get(name)?.length) {
      fail('reactive setup derivations are not implemented yet; use the expression directly in JSX', fn);
    }
    const listPrefixes = new Map<string, number>();
    const { nodes, slots, events, bindings, handlers, children, regions, lists, componentNames } = lowerDesktopScene(root, {
      callbacks: planComponentCallbacks(ctx, name, component),
      sources: expressionFacts.get(name)!, instrument, fail, fresh, components: ctx.componentProps, imports: ctx.importedComponents,
      listSite: call => analyzeMapSite(ctx, call, path, name, listPrefixes),
    });
    const props = desktopProps(ctx.componentProps.get(name)!, fresh, fail);
    fn.params = props.params;
    eventsUsed ||= handlers.length > 0;
    const template = { id: `${moduleId}#${name}`, nodes, slots, events, stylesheets };
    const templateId = fresh(`__desktopTemplate${name}`);
    templates.push(b.variableDeclaration('const', [b.variableDeclarator(templateId, valueExpression(template))]));
    const dependencies = () => b.arrayExpression(componentNames.map(b.identifier));
    definitions.push(b.expressionStatement(b.callExpression(define, [b.identifier(name), templateId, b.arrowFunctionExpression([], dependencies())])));
    const mountOptions = b.objectExpression([
      ...(children.length ? [b.objectProperty(b.identifier('children'), b.arrayExpression(children))] : []),
      ...(regions.length ? [b.objectProperty(b.identifier('regions'), b.arrayExpression(regions))] : []),
      ...(lists.length ? [b.objectProperty(b.identifier('lists'), b.arrayExpression(lists))] : []),
      ...(componentNames.length ? [b.objectProperty(b.identifier('components'), dependencies())] : []),
      ...(props.receive ? [b.objectProperty(b.identifier('receiveProps'), props.receive)] : []),
    ]);
    fn.body.body = [...props.setup, ...statements.slice(0, -1),
      b.returnStatement(b.callExpression(mount, [
        templateId, b.arrayExpression(bindings), b.arrayExpression(handlers), mountOptions,
      ]))];
  }
  if (!ctx.compPaths.size) fail('no desktop components were found');
  program.body.unshift(b.importDeclaration([
    b.importSpecifier(mount, b.identifier('mountScene')),
    b.importSpecifier(define, b.identifier('defineSceneComponent')),
    ...(eventsUsed ? [b.importSpecifier(instrument, b.identifier('sceneEvent'))] : []),
  ], b.stringLiteral(options.runtimePath ?? '@memoized-dom/desktop')), ...templates);
  program.body.push(...definitions);
  return { code: printEstree(stripTypeScript(program), { comments: parsed.comments }).code,
    components: [...ctx.compPaths.keys()] };
}
