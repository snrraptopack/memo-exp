/** First desktop lowering: fixed primitive scenes with synchronous local events. */
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

export interface DesktopCompileOptions {
  moduleId?: string;
  runtimePath?: string;
  frontend?: EstreeFrontend;
}

export interface DesktopCompiledSource {
  readonly code: string;
  readonly components: readonly string[];
}

interface SceneNode {
  kind: 'container' | 'button' | 'text';
  parent: number | null;
  text: string;
}
interface TextSlot { node: number; type: 'text' }

/** Reuse core parsing, lexical state discovery, callback effects, and expression facts. */
export function compileDesktop(source: string, options: DesktopCompileOptions = {}): DesktopCompiledSource {
  const moduleId = options.moduleId ?? './desktop.tsx';
  const parsed = parseWithEstreeFrontendOrThrow(options.frontend ?? memoizedEstreeFrontend, source,
    { filename: moduleId, sourceType: 'module' });
  const program = parsed.program as t.Program;
  const fail: (message: string, at?: t.Node) => never = (message, at = program) => {
    throw compilerError(`memo-dom desktop: ${message}`, moduleId, at);
  };
  // CSS extraction has no desktop style contract yet; never silently ignore it.
  if (parsed.css) fail('CSS styles are not supported by the first desktop backend');
  normalizeEstreeDialect(program);
  const path: ProgramPath = { node: program, buildCodeFrameError: (message, at) => compilerError(message, moduleId, at) };
  normalizeComponentDeclarations(path);
  const ctx = createAnalysisCtx({ moduleId });
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
    if (fn.async || fn.generator || fn.params.length) fail('components must be synchronous and take no props in this first slice', fn);
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
    const nodes: SceneNode[] = [];
    const slots: TextSlot[] = [];
    const bindings: t.Expression[] = [];
    const events: { node: number; type: 'click' }[] = [];
    const handlers: t.Expression[] = [];
    const callbacks = planComponentCallbacks(ctx, name, component);
    const sources = expressionFacts.get(name)!;
    if (ctx.instanceDerivations.get(name)?.length) {
      fail('reactive setup derivations are not implemented yet; use the expression directly in JSX', fn);
    }

    const addText = (text: string, parent: number | null): number => {
      const node = nodes.length;
      nodes.push({ kind: 'text', parent, text });
      return node;
    };
    const emit = (element: t.Node, parent: number | null): void => {
      if (b.isJSXFragment(element)) {
        for (const child of element.children) emit(child, parent);
        return;
      }
      if (b.isJSXText(element)) {
        if (element.value !== '') addText(element.value, parent);
        return;
      }
      if (b.isJSXExpressionContainer(element)) {
        const expression = unwrapTypeExpression(element.expression);
        if (b.isJSXEmptyExpression(expression)) return;
        walkAst<t.Node>(expression, { enter(node) {
          if (b.isJSXElement(node) || b.isJSXFragment(node) || node.type === 'ConditionalExpression' ||
              node.type === 'LogicalExpression' || node.type === 'ArrayExpression' || node.type === 'ArrowFunctionExpression' ||
              node.type === 'FunctionExpression') fail('structural expressions are not implemented yet', node);
        } });
        const slot = slots.length;
        slots.push({ node: addText('', parent), type: 'text' });
        let dependencies = sources.sourcesFor(expression as t.Expression);
        walkAst<t.Node>(expression, { enter(node) {
          // Desktop's first slice has no getter/property provenance analysis.
          // Hidden reads must refresh even when the receiver's binding is stable.
          if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') dependencies = null;
        } });
        bindings.push(b.objectExpression([
          b.objectProperty(b.identifier('slot'), b.numericLiteral(slot)),
          b.objectProperty(b.identifier('sources'), valueExpression(dependencies)),
          b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], expression as t.Expression)),
        ]));
        return;
      }
      if (!b.isJSXElement(element)) fail('unsupported JSX child', element);
      const opening = element.openingElement;
      if (!b.isJSXIdentifier(opening.name)) fail('dynamic tags are not implemented yet', opening);
      const kind = opening.name.name;
      if (!['container', 'button', 'text'].includes(kind)) fail(`unsupported desktop primitive <${kind}>`, opening);
      const node = nodes.length;
      nodes.push({ kind: kind as SceneNode['kind'], parent, text: '' });
      for (const attribute of opening.attributes) {
        if (!b.isJSXAttribute(attribute) || !b.isJSXIdentifier(attribute.name) || attribute.name.name !== 'onClick') {
          fail('only onClick is supported in this first desktop slice', attribute);
        }
        if (kind !== 'button') fail('onClick currently requires a button', attribute);
        const value = attribute.value;
        if (!value || !b.isJSXExpressionContainer(value)) fail('onClick requires a callback expression', attribute);
        const expression = unwrapTypeExpression(value.expression) as t.Expression;
        const callback = callbacks.forEvent(expression);
        if (!callback) fail('onClick requires an inline callback or component-local helper', attribute);
        assertSynchronousCallback(callback.target, fail);
        for (const helper of callback.helpers) assertSynchronousCallback(helper.target, fail);
        const plan = callback.writesFor(undefined, true);
        const changed = new Set<string>();
        let conservative = plan.executionAwareRoot;
        for (const writes of plan.scopes.values()) {
          for (const key of writes.instanceWrites) changed.add(key.split('.')[0]!);
          conservative ||= writes.rootFallback || writes.eventFallback || writes.writes.size > 0;
        }
        // Helpers are kept intact. Their effects are conservatively replayed until
        // desktop lowering instruments their individual mutation sites.
        conservative ||= callback.helpers.length > 0;
        events.push({ node, type: 'click' });
        handlers.push(b.callExpression(instrument, [expression,
          valueExpression(conservative ? null : [...changed].sort())]));
        eventsUsed = true;
      }
      for (const child of element.children) emit(child, node);
    };
    emit(root, null);
    // One template root makes mount/disposal identity unambiguous.
    if (nodes.filter(node => node.parent === null).length !== 1) fail('a scene must have one root primitive', root);
    const template = { id: `${moduleId}#${name}`, nodes, slots, events };
    const templateId = fresh(`__desktopTemplate${name}`);
    templates.push(b.variableDeclaration('const', [b.variableDeclarator(templateId, valueExpression(template))]));
    fn.body.body = [...statements.slice(0, -1),
      b.variableDeclaration('let', [b.variableDeclarator(instance, null)]),
      b.expressionStatement(b.assignmentExpression('=', instance, b.callExpression(mount, [
        templateId, b.arrayExpression(bindings), b.arrayExpression(handlers),
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

function valueExpression(value: unknown): t.Expression {
  if (Array.isArray(value)) return b.arrayExpression(value.map(valueExpression));
  if (value !== null && typeof value === 'object') return b.objectExpression(Object.entries(value).map(([key, item]) =>
    b.objectProperty(b.identifier(key), valueExpression(item))));
  if (value === null) return b.nullLiteral();
  if (typeof value === 'string') return b.stringLiteral(value);
  if (typeof value === 'number') return b.numericLiteral(value);
  if (typeof value === 'boolean') return b.booleanLiteral(value);
  throw new TypeError('Invalid desktop template value');
}

function assertSynchronousCallback(node: t.Node, fail: (message: string, at: t.Node) => never): void {
  walkAst(node, { enter(current) {
    if (current.type === 'AwaitExpression' || current.type === 'YieldExpression' ||
        ('async' in current && current.async === true)) fail('asynchronous callbacks are not implemented yet', current);
  } });
}

