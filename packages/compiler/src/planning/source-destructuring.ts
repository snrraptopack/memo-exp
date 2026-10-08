/** Authored source projections and validation, before generated bindings exist. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode, cloneNode, unwrapTypeExpression, walkAst,
  type BaseNode, type Binding, type Identifier, type ScopeAnalysis,
} from '../ast';
import type { Ctx } from '../context/model';

const COLORLESS_DESTRUCTURING_ERROR =
  'memo-dom: [MMD-S004] Colorless server function and $fetch sources cannot be destructured. Destructuring copies values before the source settles. Bind the source and read properties at the use site, or destructure a settled plain value.';
const UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR =
  'memo-dom: [MMD-S004] This colorless-source destructuring form cannot be kept reactive. Use a function-local const declaration without object rest, or read properties from the source directly.';

export type SourceProjection =
  | { readonly kind: 'binding'; readonly identifier: t.Identifier }
  | { readonly kind: 'default'; readonly target: SourceProjection; readonly fallback: t.Expression }
  | { readonly kind: 'array'; readonly entries: readonly {
      readonly index: number; readonly rest: boolean; readonly target: SourceProjection;
    }[] }
  | { readonly kind: 'object'; readonly entries: readonly {
      readonly key: t.Expression; readonly computed: boolean; readonly target: SourceProjection;
    }[] };

export type SourceDestructuringEntry =
  | { readonly kind: 'retain'; readonly declaration: t.VariableDeclarator }
  | { readonly kind: 'project'; readonly projection: SourceProjection;
      readonly source: { readonly kind: 'binding'; readonly name: string }
        | { readonly kind: 'creation'; readonly expression: t.Expression } };

export interface SourceDestructuringPlan {
  readonly declaration: t.VariableDeclaration;
  readonly entries: readonly SourceDestructuringEntry[];
}

export function planSourceDestructuring(
  ctx: Pick<Ctx, 'compPaths' | 'transparentSourceFactories' | 'transparentModuleSources'>,
  program: t.Program,
  analysis: ScopeAnalysis,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): readonly SourceDestructuringPlan[] {
  const sourceBindings = new Set<Binding>();
  const supportedSourceBindings = new Set<Binding>();
  const sourceOrigins = new Map<Binding, string>();
  const componentNodes = new Set([...ctx.compPaths.values()].map(path => path.node as unknown as BaseNode));
  const bindingAt = (node: BaseNode, name: string) => analysis.nodeToScope.get(node)?.getBinding(name);
  const isDirectComponentDeclaration = (node: BaseNode): boolean => {
    const declaration = analysis.parentByNode.get(node);
    if (declaration?.type !== 'VariableDeclaration') return false;
    const body = analysis.parentByNode.get(declaration);
    return body?.type === 'BlockStatement' && componentNodes.has(analysis.parentByNode.get(body)!);
  };
  const sourceExpression = (candidate: BaseNode | null): boolean => {
    if (candidate === null) return false;
    const expression = unwrapTypeExpression(candidate);
    if (expression.type === 'Identifier') {
      const identifier = expression as Identifier;
      const binding = bindingAt(identifier, identifier.name);
      return binding !== undefined && (sourceBindings.has(binding) ||
        binding.kind === 'import' && ctx.transparentModuleSources.has(identifier.name));
    }
    return astFactory.isCallExpression(expression) && astFactory.isIdentifier(expression.callee) &&
      ctx.transparentSourceFactories.has(expression.callee.name) &&
      bindingAt(expression, expression.callee.name)?.kind === 'import';
  };
  let changed = true;
  while (changed) {
    changed = false;
    walkAst(program as unknown as BaseNode, { enter(node) {
      if (node.type !== 'VariableDeclarator') return;
      const id = childNode(node, 'id'), init = childNode(node, 'init');
      if (id?.type !== 'Identifier' || !sourceExpression(init)) return;
      const identifier = id as Identifier;
      const binding = bindingAt(identifier, identifier.name);
      if (binding === undefined || sourceBindings.has(binding)) return;
      sourceBindings.add(binding);
      if (init?.type === 'Identifier') {
        const source = init as Identifier;
        const origin = bindingAt(source, source.name);
        sourceOrigins.set(binding, origin === undefined ? source.name : sourceOrigins.get(origin) ?? source.name);
        if (origin !== undefined && (supportedSourceBindings.has(origin) ||
            origin.kind === 'import' && ctx.transparentModuleSources.has(source.name))) {
          supportedSourceBindings.add(binding);
        }
      } else {
        sourceOrigins.set(binding, identifier.name);
        if (isDirectComponentDeclaration(node)) supportedSourceBindings.add(binding);
      }
      changed = true;
    } });
  }
  const insideComponent = (node: BaseNode): boolean => {
    let current: BaseNode | null = node;
    while (current !== null) {
      if (componentNodes.has(current)) return true;
      current = analysis.parentByNode.get(current) ?? null;
    }
    return false;
  };
  const projection = (pattern: t.LVal): SourceProjection => {
    if (astFactory.isIdentifier(pattern)) return Object.freeze({kind: 'binding', identifier: cloneNode(pattern, true)});
    if (astFactory.isAssignmentPattern(pattern)) return Object.freeze({
      // Retain lexical subtree placement so nested declaration plans still apply.
      kind: 'default', target: projection(pattern.left as t.LVal), fallback: pattern.right,
    });
    if (astFactory.isArrayPattern(pattern)) return Object.freeze({kind: 'array', entries: Object.freeze(
      pattern.elements.flatMap((element, index) => element === null ? [] : [Object.freeze({
        index, rest: astFactory.isRestElement(element),
        target: projection(astFactory.isRestElement(element) ? element.argument as t.LVal : element as t.LVal),
      })]),
    )});
    if (!astFactory.isObjectPattern(pattern)) throw errorAt.buildCodeFrameError(UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR, pattern);
    return Object.freeze({kind: 'object', entries: Object.freeze(pattern.properties.map(property => {
      if (astFactory.isRestElement(property)) throw errorAt.buildCodeFrameError(UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR, property);
      const key = property.computed ? property.key as t.Expression
        : astFactory.isIdentifier(property.key) ? astFactory.identifier(property.key.name)
        : astFactory.isStringLiteral(property.key) || astFactory.isNumericLiteral(property.key) ? property.key : null;
      if (key === null) throw errorAt.buildCodeFrameError(UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR, property);
      return Object.freeze({key: cloneNode(key, true), computed: property.computed, target: projection(property.value as t.LVal)});
    }))});
  };
  // Validate assignment/default patterns before collecting declaration plans.
  walkAst(program as unknown as BaseNode, { enter(node) {
    if (node.type !== 'AssignmentExpression' && node.type !== 'AssignmentPattern') return;
    const pattern = childNode(node, 'left');
    if ((pattern?.type === 'ObjectPattern' || pattern?.type === 'ArrayPattern') &&
        sourceExpression(childNode(node, 'right'))) {
      throw errorAt.buildCodeFrameError(COLORLESS_DESTRUCTURING_ERROR, pattern as unknown as t.Node);
    }
  } });
  const plans: SourceDestructuringPlan[] = [];
  walkAst(program as unknown as BaseNode, { enter(node) {
    if (!astFactory.isVariableDeclaration(node)) return;
    const declaration = node;
    let projected = false;
    const entries: SourceDestructuringEntry[] = declaration.declarations.map(declarator => {
      if ((!astFactory.isObjectPattern(declarator.id) && !astFactory.isArrayPattern(declarator.id)) ||
          declarator.init === null || !sourceExpression(declarator.init as unknown as BaseNode)) {
        return Object.freeze({kind: 'retain', declaration: declarator});
      }
      if (!insideComponent(node)) throw errorAt.buildCodeFrameError(COLORLESS_DESTRUCTURING_ERROR, declarator.id);
      let source: Extract<SourceDestructuringEntry, {kind: 'project'}>['source'];
      if (astFactory.isIdentifier(declarator.init)) {
        const binding = bindingAt(declarator.init as unknown as BaseNode, declarator.init.name);
        if (binding === undefined || !(supportedSourceBindings.has(binding) ||
            binding.kind === 'import' && ctx.transparentModuleSources.has(declarator.init.name))) {
          throw errorAt.buildCodeFrameError(UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR, declarator.id);
        }
        source = Object.freeze({kind: 'binding', name: sourceOrigins.get(binding) ?? declarator.init.name});
      } else {
        if (!isDirectComponentDeclaration(declarator as unknown as BaseNode)) {
          throw errorAt.buildCodeFrameError(UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR, declarator.id);
        }
        source = Object.freeze({kind: 'creation', expression: declarator.init});
      }
      projected = true;
      return Object.freeze({kind: 'project', source, projection: projection(declarator.id)});
    });
    if (projected) plans.push(Object.freeze({declaration, entries: Object.freeze(entries)}));
  } });
  return Object.freeze(plans);
}
