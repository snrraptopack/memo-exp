/** Desktop lowering: fixed component trees with synchronous lexical state. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { parseWithEstreeFrontendOrThrow, type EstreeFrontend } from '../ast/parser';
import { memoizedEstreeFrontend } from '../ast/tsrx/frontend';
import { printEstree } from '../ast/printer';
import { stripTypeScript } from '../ast/strip-typescript';
import { walkAst } from '../ast/walk';
import { normalizeEstreeDialect, unwrapTypeExpression } from '../ast/normalize';
import { createAnalysisCtx, type ProgramPath } from '../context/model';
import { refreshAstAnalysis } from '../context/ast';
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

export interface DesktopCompileOptions {
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
  const linkedImports = desktopComponentImports(program, moduleId, options.frontend ?? memoizedEstreeFrontend, options.readModule);
  const ctx = createAnalysisCtx({ moduleId, linkedImports });
  refreshAstAnalysis(ctx, program);
  validateLinkedImports(ctx, path);
  scanModuleState(ctx, path);
  scanComponents(ctx, path);
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
  let eventsUsed = false;
  const templates: t.Statement[] = [];

  for (const [name, component] of ctx.compPaths) {
    const fn = component.node;
    if (fn.async || fn.generator) fail('components must be synchronous', fn);
    const statements = fn.body.body;
    const last = statements.at(-1);
    if (!last || !b.isReturnStatement(last) || !last.argument) fail('components need a final fixed JSX return', fn);
    const root = unwrapTypeExpression(last.argument);
    if (!b.isJSXElement(root) && !b.isJSXFragment(root)) fail('branches and dynamic component roots are not implemented yet', root);
    for (const statement of statements.slice(0, -1)) {
      if (b.isReturnStatement(statement)) fail('early component returns are not implemented yet', statement);
      walkAst<t.Node>(statement, { enter(node) {
        if (b.isJSXElement(node) || b.isJSXFragment(node)) fail('nested component factories are not implemented yet', node);
        if (node.type === 'AwaitExpression' || node.type === 'YieldExpression') fail('asynchronous callbacks are not implemented yet', node);
      } });
    }
    const instance = fresh('__desktopInstance');
    if (ctx.instanceDerivations.get(name)?.length) {
      fail('reactive setup derivations are not implemented yet; use the expression directly in JSX', fn);
    }
    const { nodes, slots, events, bindings, handlers, children } = lowerDesktopScene(root, {
      callbacks: planComponentCallbacks(ctx, name, component),
      sources: expressionFacts.get(name)!, instrument, fail, components: ctx.componentProps, imports: ctx.importedComponents,
    });
    const props = desktopProps(ctx.componentProps.get(name)!, fresh, fail);
    fn.params = props.params;
    eventsUsed ||= handlers.length > 0;
    const template = { id: `${moduleId}#${name}`, nodes, slots, events, stylesheets };
    const templateId = fresh(`__desktopTemplate${name}`);
    templates.push(b.variableDeclaration('const', [b.variableDeclarator(templateId, valueExpression(template))]));
    const mountOptions = b.objectExpression([
      ...(children.length ? [b.objectProperty(b.identifier('children'), b.arrayExpression(children))] : []),
      ...(props.receive ? [b.objectProperty(b.identifier('receiveProps'), props.receive)] : []),
    ]);
    fn.body.body = [...props.setup, ...statements.slice(0, -1),
      b.variableDeclaration('let', [b.variableDeclarator(instance, null)]),
      b.expressionStatement(b.assignmentExpression('=', instance, b.callExpression(mount, [
        templateId, b.arrayExpression(bindings), b.arrayExpression(handlers), mountOptions,
      ]))), b.returnStatement(instance)];
  }
  if (!ctx.compPaths.size) fail('no desktop components were found');
  program.body.unshift(b.importDeclaration([
    b.importSpecifier(mount, b.identifier('mountScene')),
    ...(eventsUsed ? [b.importSpecifier(instrument, b.identifier('sceneEvent'))] : []),
  ], b.stringLiteral(options.runtimePath ?? '@memoized-dom/desktop')), ...templates);
  return { code: printEstree(stripTypeScript(program), { comments: parsed.comments }).code,
    components: [...ctx.compPaths.keys()] };
}
