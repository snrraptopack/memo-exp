/** Semantic analysis for transparent-source read rewriting. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import { astBindingAt, type Ctx } from '../../context';
import { jsxAttributeName } from '../../jsx/attributes';

export interface TransparentDerivation {
  binding: AstBinding;
  sources: readonly string[];
  expression: t.Expression;
}

export function isBoundTo(
  ctx: Ctx,
  identifier: BaseNode,
  binding: AstBinding,
): boolean {
  if (identifier.type !== 'Identifier') return false;
  const astIdentifier = identifier as unknown as AstIdentifier;
  const resolved = astBindingAt(ctx, identifier, astIdentifier.name);
  return resolved?.identifier === binding.identifier &&
    resolved.references.includes(astIdentifier);
}

export function isEventOrRefContainer(ctx: Ctx, container: BaseNode): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (parent?.type !== 'JSXAttribute') return false;
  const name = jsxAttributeName(
    (parent as unknown as t.JSXAttribute).name,
  );
  return name === 'ref' || /^on[A-Z]/.test(name);
}

function isComponentPropContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (attribute?.type !== 'JSXAttribute') return false;
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (opening?.type !== 'JSXOpeningElement') return false;
  const name = (opening as unknown as t.JSXOpeningElement).name;
  return astFactory.isJSXIdentifier(name) && /^[A-Z]/.test(name.name);
}

export function isDirectSourceComponentProp(
  ctx: Ctx,
  container: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
): boolean {
  if (!isComponentPropContainer(ctx, container)) return false;
  const expression = childNode(container, 'expression');
  if (expression?.type !== 'Identifier') return false;
  const name = (expression as unknown as AstIdentifier).name;
  const binding = bindings.get(name);
  return binding !== undefined && isBoundTo(ctx, expression, binding);
}

export function isWithinDirectSourceComponentProp(
  ctx: Ctx,
  identifier: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
): boolean {
  const container = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (
    container?.type !== 'JSXExpressionContainer' ||
    childNode(container, 'expression') !== identifier
  ) {
    return false;
  }
  return isDirectSourceComponentProp(ctx, container, bindings);
}

export function isGroupDataContainer(ctx: Ctx, container: BaseNode): boolean {
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (
    attribute?.type !== 'JSXAttribute' ||
    jsxAttributeName((attribute as unknown as t.JSXAttribute).name) !== 'data'
  ) {
    return false;
  }
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  return (
    opening?.type === 'JSXOpeningElement' &&
    astFactory.isJSXIdentifier(
      (opening as unknown as t.JSXOpeningElement).name,
      { name: 'Group' },
    )
  );
}

export function isWithinGroupData(ctx: Ctx, node: BaseNode): boolean {
  let current = ctx.astAnalysis?.parentByNode.get(node) ?? null;
  while (current !== null && current.type !== 'JSXExpressionContainer') {
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return current !== null && isGroupDataContainer(ctx, current);
}

export function isPassthroughArgument(
  ctx: Ctx,
  identifier: BaseNode,
): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (parent?.type !== 'CallExpression') return false;
  const call = parent as unknown as t.CallExpression;
  if (!call.arguments.includes(identifier as unknown as t.Expression)) return false;
  const root = astFactory.isIdentifier(call.callee) ? call.callee.name : null;
  return root !== null && ctx.transparentSourcePassthroughs.has(root);
}

export function isActionRefreshTarget(ctx: Ctx, identifier: BaseNode): boolean {
  let array = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  while (array !== null && array.type !== 'ArrayExpression') {
    array = ctx.astAnalysis?.parentByNode.get(array) ?? null;
  }
  if (array === null) return false;
  const property = ctx.astAnalysis?.parentByNode.get(array) ?? null;
  if (property?.type !== 'ObjectProperty' && property?.type !== 'Property') {
    return false;
  }
  if (childNode(property, 'value') !== array) return false;
  const objectProperty = property as unknown as t.ObjectProperty;
  const key = objectProperty.key;
  return (
    (!objectProperty.computed && astFactory.isIdentifier(key, { name: 'refresh' })) ||
    astFactory.isStringLiteral(key, { value: 'refresh' })
  );
}

export function isGeneratedDataCall(ctx: Ctx, node: BaseNode): boolean {
  let call = ctx.astAnalysis?.parentByNode.get(node) ?? null;
  while (call !== null && call.type !== 'CallExpression') {
    call = ctx.astAnalysis?.parentByNode.get(call) ?? null;
  }
  if (call === null) return false;
  const callee = (call as unknown as t.CallExpression).callee;
  return (
    astFactory.isMemberExpression(callee) &&
    astFactory.isIdentifier(callee.object, {
      name: ctx.identifiers?.dataRuntimeId,
    })
  );
}

export function sourceBindings(
  ctx: Ctx,
  component: BaseNode,
  names: ReadonlySet<string>,
): Map<string, AstBinding> {
  const bindings = new Map<string, AstBinding>();
  for (const name of names) {
    const binding = astBindingAt(ctx, component, name);
    if (binding !== undefined) bindings.set(name, binding);
  }
  return bindings;
}

/**
 * Event-created sources are nullable holders before their first assignment.
 * Writes and existence guards inspect the holder itself; only later property
 * reads consume its resolved payload.
 */
export function isEventSourceHolderReference(
  ctx: Ctx,
  identifier: BaseNode,
  eventSources: ReadonlySet<string>,
): boolean {
  if (
    identifier.type !== 'Identifier' ||
    !eventSources.has((identifier as unknown as AstIdentifier).name)
  ) return false;
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  if (parent === null) return false;
  if (
    parent.type === 'AssignmentExpression' &&
    childNode(parent, 'left') === identifier
  ) return true;
  if (
    parent.type === 'BinaryExpression' ||
    parent.type === 'LogicalExpression'
  ) {
    const left = childNode(parent, 'left');
    const right = childNode(parent, 'right');
    if (
      parent.type === 'BinaryExpression' &&
      ['==', '!=', '===', '!=='].includes(
        (parent as unknown as t.BinaryExpression).operator,
      )
    ) {
      const other = left === identifier ? right : left;
      if (other !== null && astFactory.isNullLiteral(other as unknown as t.Node)) {
        return true;
      }
    }
    if (parent.type === 'LogicalExpression' && left === identifier) return true;
  }
  if (
    parent.type === 'UnaryExpression' &&
    (parent as unknown as t.UnaryExpression).operator === '!' &&
    childNode(parent, 'argument') === identifier
  ) return true;
  if (
    (parent.type === 'ConditionalExpression' || parent.type === 'IfStatement') &&
    childNode(parent, 'test') === identifier
  ) return true;
  return false;
}

export function sourceDependencies(
  ctx: Ctx,
  root: BaseNode,
  bindings: ReadonlyMap<string, AstBinding>,
  derived: ReadonlyMap<string, TransparentDerivation>,
  eventSources: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const note = (identifier: BaseNode): void => {
    const name = (identifier as unknown as AstIdentifier).name;
    const binding = bindings.get(name);
    if (binding !== undefined && isBoundTo(ctx, identifier, binding)) {
      if (
        !isPassthroughArgument(ctx, identifier) &&
        !isEventSourceHolderReference(ctx, identifier, eventSources)
      ) {
        found.add(name);
      }
      return;
    }
    const derivation = derived.get(name);
    if (
      derivation !== undefined &&
      isBoundTo(ctx, identifier, derivation.binding)
    ) {
      for (const source of derivation.sources) found.add(source);
    }
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node);
    },
  });
  return [...found].sort();
}
