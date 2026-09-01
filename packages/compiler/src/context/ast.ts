import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  analyzeScope,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Scope,
  type ScopeAnalysis,
} from '../ast';
import { generatedIdentifier } from '../identifiers';
import type { Ctx, StateKind } from './model';

/** Rebuild parser-neutral parent and lexical-scope facts after AST mutation. */
export function refreshAstAnalysis(
  ctx: Ctx,
  root: BaseNode,
): ScopeAnalysis {
  const analysis = analyzeScope(root);
  ctx.astAnalysis = analysis;
  return analysis;
}

/** Lexical scope active at a node in the latest parser-neutral index. */
export function astScopeAt(ctx: Ctx, node: BaseNode): Scope | undefined {
  return ctx.astAnalysis?.nodeToScope.get(node);
}

/** Resolve a binding from a node without Babel NodePath scope services. */
export function astBindingAt(
  ctx: Ctx,
  node: BaseNode,
  name: string,
): AstBinding | undefined {
  return astScopeAt(ctx, node)?.getBinding(name);
}

/** Remove TypeScript-only wrappers without changing runtime semantics. */
export function unwrapTypeExpression<TExpression extends BaseNode>(
  expression: TExpression,
): TExpression {
  let current: BaseNode = expression;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSInstantiationExpression'
  ) {
    const inner = (current as unknown as { expression: BaseNode }).expression;
    current = inner;
  }
  return current as TExpression;
}

/** Register a state binding while preserving a linker-provided import entry. */
export function registerState(ctx: Ctx, name: string, kind: StateKind): void {
  ctx.state.set(name, kind);
  if (!ctx.stateKeys.has(name)) {
    ctx.stateKeys.set(name, `${ctx.moduleId}#${name}`);
  }
}

/** Convert a binding-relative analysis key to its defining module identity. */
export function canonicalStateKey(ctx: Ctx, key: string): string {
  if (key.includes('#')) return key;
  const dot = key.indexOf('.');
  const root = dot === -1 ? key : key.slice(0, dot);
  const suffix = dot === -1 ? '' : key.slice(dot);
  return `${ctx.stateKeys.get(root) ?? root}${suffix}`;
}

/** Hoist and dedupe a canonical write-set constant. */
export function freshWriteConst(
  ctx: Ctx,
  writes: readonly string[],
): t.Identifier {
  const canonicalWrites = [
    ...new Set(writes.map((write) => canonicalStateKey(ctx, write))),
  ].sort();
  const key = canonicalWrites.join(' ');
  const existing = ctx.writeConsts.get(key);
  if (existing !== undefined) return astFactory.identifier(existing);
  const id = generatedIdentifier(ctx, `WRITES_${ctx.writeConstCounter++}`);
  ctx.writeConsts.set(key, id.name);
  ctx.header.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        id,
        astFactory.arrayExpression(
          canonicalWrites.map((write) => astFactory.stringLiteral(write)),
        ),
      ),
    ]),
  );
  return id;
}

/** Hoist and dedupe a sorted array used to batch local dirty reasons. */
export function freshReasonConst(
  ctx: Ctx,
  reasons: readonly number[],
): t.Identifier {
  const unique = [...new Set(reasons)].sort((left, right) => left - right);
  const key = unique.join(' ');
  const existing = ctx.reasonConsts.get(key);
  if (existing !== undefined) return astFactory.identifier(existing);
  const id = generatedIdentifier(
    ctx,
    `REASONS_${ctx.reasonConstCounter++}`,
  );
  ctx.reasonConsts.set(key, id.name);
  ctx.header.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        id,
        astFactory.arrayExpression(
          unique.map((reason) => astFactory.numericLiteral(reason)),
        ),
      ),
    ]),
  );
  return id;
}

type MemberLike = t.MemberExpression | t.OptionalMemberExpression;

function isMemberLike(node: t.Node): node is MemberLike {
  return astFactory.isMemberExpression(node) || astFactory.isOptionalMemberExpression(node);
}

/** Static property-path key for `a.b.c`, including optional member chains. */
export function memberKey(node: MemberLike): string | null {
  const parts: string[] = [];
  let current: t.Expression | t.PrivateName = node;
  while (isMemberLike(current)) {
    if (current.computed) {
      if (!astFactory.isStringLiteral(current.property)) return null;
      parts.unshift(current.property.value);
    } else {
      if (!astFactory.isIdentifier(current.property)) return null;
      parts.unshift(current.property.name);
    }
    if (astFactory.isSuper(current.object)) return null;
    current = current.object;
  }
  while (
    astFactory.isTSNonNullExpression(current) ||
    astFactory.isTSAsExpression(current) ||
    astFactory.isTSTypeAssertion(current) ||
    astFactory.isTSSatisfiesExpression(current) ||
    astFactory.isTSInstantiationExpression(current)
  ) {
    current = current.expression;
  }
  if (!astFactory.isIdentifier(current)) return null;
  parts.unshift(current.name);
  return parts.join('.');
}

/** Reactive list-row context used during event-handler analysis. */
export interface RowCtx {
  itemParam: string;
  itemPath: string[];
  rowIdVar: string;
  refreshVar?: string;
  keyPath: string[] | null;
  sourceKey: string;
  sourceLocal?: boolean;
  ownerIdVar?: string;
}

/** Extract a row key path relative to its item parameter. */
export function keyPathOf(
  keyExpr: t.Expression | null,
  itemParam: string,
): string[] | null {
  if (keyExpr === null) return [];
  const segments: string[] = [];
  let current: t.Expression = keyExpr;
  while (astFactory.isMemberExpression(current) && !current.computed) {
    if (!astFactory.isIdentifier(current.property)) return null;
    segments.unshift(current.property.name);
    if (astFactory.isSuper(current.object)) return null;
    current = current.object;
  }
  if (
    !astFactory.isIdentifier(current, { name: itemParam }) ||
    segments.length === 0
  ) {
    return null;
  }
  return segments;
}

/** Whether an item-relative write can alter the authored row key. */
export function writeTouchesKey(
  writtenSegments: string[],
  keyPath: string[] | null,
): boolean {
  if (keyPath === null) return true;
  if (keyPath.length === 0) return false;
  if (writtenSegments.length > keyPath.length) return false;
  return writtenSegments.every(
    (segment, index) => keyPath[index] === segment,
  );
}

export interface ComputedAnalysis {
  reads: Set<string>;
  impure: boolean;
  reason?: string;
}

/** Root identifier of a member chain, including optional member segments. */
export function memberRootName(node: MemberLike): string | null {
  let current: t.Expression = node;
  while (true) {
    if (isMemberLike(current)) {
      if (astFactory.isSuper(current.object)) return null;
      current = current.object;
      continue;
    }
    if (
      astFactory.isTSNonNullExpression(current) ||
      astFactory.isTSAsExpression(current) ||
      astFactory.isTSTypeAssertion(current) ||
      astFactory.isTSSatisfiesExpression(current) ||
      astFactory.isTSInstantiationExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    break;
  }
  return astFactory.isIdentifier(current) ? current.name : null;
}

/** Whether an initializer is a statically-shaped plain object store. */
export function isStoreObject(
  init: t.Expression | null | undefined,
): boolean {
  if (!init) return false;
  const current = unwrapTypeExpression(init);
  if (!astFactory.isObjectExpression(current)) return false;
  return current.properties.every(
    (property) =>
      astFactory.isObjectProperty(property) &&
      !property.computed &&
      (astFactory.isIdentifier(property.key) || astFactory.isStringLiteral(property.key)),
  );
}

/** Whether a const initializer creates a mutable object root. */
export function isConstObjectState(
  init: t.Expression | null | undefined,
): boolean {
  if (!init) return false;
  const current = unwrapTypeExpression(init);
  return astFactory.isArrayExpression(current) || astFactory.isNewExpression(current);
}

/** Unwrap a string or expression-container JSX attribute value. */
export function attrExpr(
  value: t.JSXAttribute['value'],
): t.Expression | null {
  if (value == null) return null;
  if (astFactory.isStringLiteral(value)) return value;
  if (astFactory.isJSXExpressionContainer(value)) {
    return astFactory.isJSXEmptyExpression(value.expression)
      ? null
      : (value.expression as t.Expression);
  }
  return null;
}

/** Whether an expression references any reactive binding in its scope model. */
export function exprReadsState(
  ctx: Ctx,
  expression: t.Node,
  componentName?: string,
): boolean {
  const instance =
    componentName !== undefined
      ? ctx.instanceState.get(componentName)
      : undefined;
  const derived =
    componentName !== undefined
      ? ctx.instanceDerivedBindings.get(componentName)
      : undefined;
  const props =
    componentName !== undefined
      ? ctx.componentProps.get(componentName)?.bindings
      : undefined;
  let reads = false;
  walkNodes(expression, (node) => {
    if (reads) return false;
    if (
      astFactory.isIdentifier(node) &&
      (ctx.state.has(node.name) ||
        instance?.has(node.name) === true ||
        derived?.has(node.name) === true ||
        props?.includes(node.name) === true)
    ) {
      reads = true;
      return false;
    }
    return undefined;
  });
  return reads;
}

/** Whether an expression references state owned by one component instance. */
export function exprReadsInstanceState(
  ctx: Ctx,
  expression: t.Node,
  componentName: string,
): boolean {
  const roots = new Set<string>([
    ...(ctx.instanceState.get(componentName) ?? []),
    ...(ctx.instanceDerivedBindings.get(componentName) ?? []),
    ...(ctx.componentProps.get(componentName)?.bindings ?? []),
  ]);
  if (roots.size === 0) return false;

  let reads = false;
  walkNodes(expression, (node) => {
    if (astFactory.isIdentifier(node) && roots.has(node.name)) {
      reads = true;
      return false;
    }
    return reads ? false : undefined;
  });
  return reads;
}

/** Walk raw AST nodes; returning false skips a node's children. */
export function walkNodes(
  root: t.Node,
  visit: (node: t.Node, parent: t.Node | null) => void | boolean,
): void {
  walkAst(root, {
    enter(node, parent) {
      return visit(node, parent);
    },
  });
}

/** Whether a raw AST subtree contains JSX. */
export function nodeHasJsx(root: t.Node): boolean {
  let found = false;
  walkNodes(root, (node) => {
    if (astFactory.isJSXElement(node) || astFactory.isJSXFragment(node)) found = true;
  });
  return found;
}

/** Root state identifiers referenced by a raw AST subtree. */
export function collectStateIds(ctx: Ctx, root: t.Node): Set<string> {
  const output = new Set<string>();
  walkNodes(root, (node) => {
    if (
      astFactory.isJSXAttribute(node) &&
      astFactory.isJSXIdentifier(node.name, { name: 'ref' })
    ) {
      return false;
    }
    if (astFactory.isIdentifier(node) && ctx.state.has(node.name)) {
      output.add(node.name);
    }
  });
  return output;
}
