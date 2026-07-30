import * as t from '@babel/types';
import { generatedIdentifier } from '../identifiers';
import type { Ctx, StateKind } from './model';

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
  if (existing !== undefined) return t.identifier(existing);
  const id = generatedIdentifier(ctx, `WRITES_${ctx.writeConstCounter++}`);
  ctx.writeConsts.set(key, id.name);
  ctx.header.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        id,
        t.arrayExpression(
          canonicalWrites.map((write) => t.stringLiteral(write)),
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
  if (existing !== undefined) return t.identifier(existing);
  const id = generatedIdentifier(
    ctx,
    `REASONS_${ctx.reasonConstCounter++}`,
  );
  ctx.reasonConsts.set(key, id.name);
  ctx.header.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        id,
        t.arrayExpression(
          unique.map((reason) => t.numericLiteral(reason)),
        ),
      ),
    ]),
  );
  return id;
}

/** Static property-path key for `a.b.c`, or null for a dynamic path. */
export function memberKey(node: t.MemberExpression): string | null {
  const parts: string[] = [];
  let current: t.Expression | t.PrivateName = node;
  while (t.isMemberExpression(current)) {
    if (current.computed) {
      if (!t.isStringLiteral(current.property)) return null;
      parts.unshift(current.property.value);
    } else {
      if (!t.isIdentifier(current.property)) return null;
      parts.unshift(current.property.name);
    }
    if (t.isSuper(current.object)) return null;
    current = current.object;
  }
  while (
    t.isTSNonNullExpression(current) ||
    t.isTSAsExpression(current)
  ) {
    current = current.expression;
  }
  if (!t.isIdentifier(current)) return null;
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
  while (t.isMemberExpression(current) && !current.computed) {
    if (!t.isIdentifier(current.property)) return null;
    segments.unshift(current.property.name);
    if (t.isSuper(current.object)) return null;
    current = current.object;
  }
  if (
    !t.isIdentifier(current, { name: itemParam }) ||
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

/** Root identifier of a member chain, including dynamic member segments. */
export function memberRootName(node: t.MemberExpression): string | null {
  let current: t.Expression = node;
  while (true) {
    if (t.isMemberExpression(current)) {
      if (t.isSuper(current.object)) return null;
      current = current.object;
      continue;
    }
    if (
      t.isTSNonNullExpression(current) ||
      t.isTSAsExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    break;
  }
  return t.isIdentifier(current) ? current.name : null;
}

/** Whether an initializer is a statically-shaped plain object store. */
export function isStoreObject(
  init: t.Expression | null | undefined,
): boolean {
  if (!init || !t.isObjectExpression(init)) return false;
  return init.properties.every(
    (property) =>
      t.isObjectProperty(property) &&
      !property.computed &&
      (t.isIdentifier(property.key) || t.isStringLiteral(property.key)),
  );
}

/** Whether a const initializer creates a mutable object root. */
export function isConstObjectState(
  init: t.Expression | null | undefined,
): boolean {
  if (!init) return false;
  return t.isArrayExpression(init) || t.isNewExpression(init);
}

/** Unwrap a string or expression-container JSX attribute value. */
export function attrExpr(
  value: t.JSXAttribute['value'],
): t.Expression | null {
  if (value == null) return null;
  if (t.isStringLiteral(value)) return value;
  if (t.isJSXExpressionContainer(value)) {
    return t.isJSXEmptyExpression(value.expression)
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
  const probe = (node: t.Node): void => {
    if (reads) return;
    if (
      t.isIdentifier(node) &&
      (ctx.state.has(node.name) ||
        instance?.has(node.name) === true ||
        derived?.has(node.name) === true ||
        props?.includes(node.name) === true)
    ) {
      reads = true;
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) {
            probe(item as t.Node);
          }
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        probe(child as t.Node);
      }
    }
  };
  probe(expression);
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
    if (t.isIdentifier(node) && roots.has(node.name)) {
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
  const walk = (node: t.Node, parent: t.Node | null): void => {
    if (visit(node, parent) === false) return;
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) {
            walk(item as t.Node, node);
          }
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        walk(child as t.Node, node);
      }
    }
  };
  walk(root, null);
}

/** Whether a raw AST subtree contains JSX. */
export function nodeHasJsx(root: t.Node): boolean {
  let found = false;
  walkNodes(root, (node) => {
    if (t.isJSXElement(node) || t.isJSXFragment(node)) found = true;
  });
  return found;
}

/** Root state identifiers referenced by a raw AST subtree. */
export function collectStateIds(ctx: Ctx, root: t.Node): Set<string> {
  const output = new Set<string>();
  walkNodes(root, (node) => {
    if (
      t.isJSXAttribute(node) &&
      t.isJSXIdentifier(node.name, { name: 'ref' })
    ) {
      return false;
    }
    if (t.isIdentifier(node) && ctx.state.has(node.name)) {
      output.add(node.name);
    }
  });
  return output;
}
