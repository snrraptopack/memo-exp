/** Request-owned module state-cell lowering for server builds. */

import * as t from '@babel/types';
import {
  cloneNode as cloneAstNode,
  walkAst,
  type BaseNode,
  type Binding,
} from './ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  type Ctx,
} from './context';
import { generatedIdentifier, md } from './identifiers';

type ReactiveKind = 'let' | 'store';

interface CellLift {
  readonly local: string;
  readonly key: string;
  readonly kind: ReactiveKind;
  readonly cellId: string;
  readonly binding: Binding;
  readonly owned: boolean;
}

interface ProgramContainer {
  node: t.Program;
  buildCodeFrameError(message: string): Error;
}

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function node(value: unknown): BaseNode | null {
  return value !== null && typeof value === 'object' && 'type' in value
    ? (value as BaseNode)
    : null;
}

function childNode(parent: BaseNode, key: string): BaseNode | null {
  return node(fields(parent)[key]);
}

function childNodes(parent: BaseNode, key: string): BaseNode[] {
  const value = fields(parent)[key];
  return Array.isArray(value)
    ? value.map(node).filter((item) => item !== null)
    : [];
}

function identifierName(value: BaseNode | null): string | null {
  if (value?.type !== 'Identifier') return null;
  const name = fields(value).name;
  return typeof name === 'string' ? name : null;
}

function cloneNode<TNode>(value: TNode): TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}

function callExpression(
  callee: t.Expression | t.V8IntrinsicIdentifier,
  arguments_: t.CallExpression['arguments'],
): t.CallExpression {
  return {
    type: 'CallExpression',
    callee,
    arguments: arguments_,
  } as t.CallExpression;
}

function binaryExpression(
  operator: t.BinaryExpression['operator'],
  left: t.Expression,
  right: t.Expression,
): t.BinaryExpression {
  return { type: 'BinaryExpression', operator, left, right } as t.BinaryExpression;
}

function returnStatement(argument: t.Expression): t.ReturnStatement {
  return { type: 'ReturnStatement', argument } as t.ReturnStatement;
}

function literalValue(value: BaseNode): unknown {
  return fields(value).value;
}

function isDeepLiteral(current: BaseNode): boolean {
  if (
    current.type === 'StringLiteral' ||
    current.type === 'NumericLiteral' ||
    current.type === 'BooleanLiteral' ||
    current.type === 'NullLiteral' ||
    current.type === 'Literal'
  ) {
    const value = literalValue(current);
    return (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    );
  }
  if (current.type === 'UnaryExpression' && fields(current).operator === '-') {
    const argument = childNode(current, 'argument');
    return argument !== null && isDeepLiteral(argument);
  }
  if (current.type === 'ObjectExpression') {
    return childNodes(current, 'properties').every((property) => {
      if (
        (property.type !== 'ObjectProperty' && property.type !== 'Property') ||
        fields(property).computed === true
      ) {
        return false;
      }
      const value = childNode(property, 'value');
      return value !== null && isDeepLiteral(value);
    });
  }
  if (current.type === 'ArrayExpression') {
    const elements = fields(current).elements;
    return (
      Array.isArray(elements) &&
      elements.every((element) => {
        const item = node(element);
        return item !== null && isDeepLiteral(item);
      })
    );
  }
  return false;
}

function variableDeclaratorFor(ctx: Ctx, binding: Binding): BaseNode | null {
  let current: BaseNode | null = binding.identifier;
  while (current !== null && current !== binding.declarationNode) {
    if (current.type === 'VariableDeclarator') return current;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return null;
}

function compoundOperator(operator: string): '+' | '-' | '*' | '/' | null {
  switch (operator) {
    case '+=':
      return '+';
    case '-=':
      return '-';
    case '*=':
      return '*';
    case '/=':
      return '/';
    default:
      return null;
  }
}

function replaceAt(
  parent: BaseNode,
  key: string,
  index: number | undefined,
  replacement: BaseNode,
): void {
  const value = fields(parent)[key];
  if (index === undefined) {
    fields(parent)[key] = replacement;
  } else if (Array.isArray(value)) {
    value[index] = replacement;
  } else {
    throw new TypeError(`Expected array field ${parent.type}.${key}`);
  }
}

export function liftModuleStateCells(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  if (ctx.moduleStateCells !== true) return;
  const program = programPath.node as unknown as BaseNode;
  refreshAstAnalysis(ctx, program);
  const lifts = new Map<string, CellLift>();

  for (const [local, kind] of ctx.state) {
    if (kind !== 'let' && kind !== 'store') continue;
    const key = ctx.stateKeys.get(local);
    if (key === undefined) continue;
    const binding = astBindingAt(ctx, program, local);
    if (binding === undefined) continue;
    const owned = binding.kind !== 'import';
    if (owned) {
      const declarator = variableDeclaratorFor(ctx, binding);
      if (declarator === null) continue;
      const initializer = childNode(declarator, 'init');
      if (kind === 'store') {
        if (initializer === null || !isDeepLiteral(initializer)) {
          throw programPath.buildCodeFrameError(
            `memo-dom: mutated store '${local}' must be initialized from a plain object/array literal to lower into request-owned state cells`,
          );
        }
      } else if (initializer !== null && !isDeepLiteral(initializer)) {
        throw programPath.buildCodeFrameError(
          `memo-dom: module-state let '${local}' must be initialized from a literal to lower into request-owned state cells`,
        );
      }
      const reExported = binding.references.some(
        (reference) =>
          ctx.astAnalysis?.parentByNode.get(reference)?.type === 'ExportSpecifier',
      );
      if (reExported) {
        throw programPath.buildCodeFrameError(
          `memo-dom: cannot lower re-exported module state '${local}'`,
        );
      }
    }
    lifts.set(local, {
      local,
      key,
      kind,
      cellId: generatedIdentifier(ctx, `cell_${local}`).name,
      binding,
      owned,
    });
  }
  if (lifts.size === 0) return;

  for (const lift of lifts.values()) {
    if (lift.owned) continue;
    const declaration = lift.binding.declarationNode;
    if (declaration.type !== 'ImportDeclaration') continue;
    const specifiers = fields(declaration).specifiers;
    if (!Array.isArray(specifiers)) continue;
    fields(declaration).specifiers = specifiers.filter((specifier) => {
      const candidate = node(specifier);
      return (
        candidate === null ||
        identifierName(childNode(candidate, 'local')) !== lift.local
      );
    });
  }

  for (const lift of lifts.values()) {
    const arguments_: t.Expression[] = [t.stringLiteral(lift.key)];
    if (lift.owned) {
      const declarator = variableDeclaratorFor(ctx, lift.binding);
      const initializer =
        declarator === null ? null : childNode(declarator, 'init');
      if (initializer !== null) {
        const cloned = cloneNode(initializer as unknown as t.Expression);
        arguments_.push(
          lift.kind === 'store'
            ? t.arrowFunctionExpression(
                [],
                t.blockStatement([returnStatement(cloned)]),
              )
            : cloned,
        );
      }
    }
    ctx.header.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(lift.cellId),
          callExpression(md(ctx, 'defineStateCell'), arguments_),
        ),
      ]),
    );
  }

  const matchesLift = (identifier: BaseNode): CellLift | undefined => {
    const name = identifierName(identifier);
    if (name === null) return undefined;
    const lift = lifts.get(name);
    if (lift === undefined) return undefined;
    const current = astBindingAt(ctx, identifier, name);
    if (current === lift.binding) return lift;
    if (
      current !== undefined &&
      current.declarationNode === lift.binding.declarationNode
    ) {
      return lift;
    }
    return !lift.owned && current === undefined ? lift : undefined;
  };
  const readCall = (lift: CellLift): t.CallExpression =>
    callExpression(md(ctx, 'readCell'), [t.identifier(lift.cellId)]);

  let typeDepth = 0;
  walkAst<BaseNode>(program, {
    enter(current, parent, key, index) {
      if (current.type.startsWith('TS')) {
        typeDepth++;
        return;
      }
      if (current.type !== 'Identifier' || parent === null || key === undefined) {
        return;
      }
      const lift = matchesLift(current);
      if (lift === undefined || typeDepth > 0) return;
      if (
        (parent.type === 'VariableDeclarator' && key === 'id') ||
        ((parent.type === 'MemberExpression' ||
          parent.type === 'OptionalMemberExpression') &&
          key === 'property' &&
          fields(parent).computed !== true) ||
        parent.type === 'ExportSpecifier' ||
        parent.type.startsWith('Import') ||
        ((parent.type === 'AssignmentExpression' && key === 'left') ||
          (parent.type === 'UpdateExpression' && key === 'argument'))
      ) {
        return;
      }
      if (
        (parent.type === 'ObjectProperty' || parent.type === 'Property') &&
        fields(parent).shorthand === true &&
        childNode(parent, 'value') === current
      ) {
        fields(parent).shorthand = false;
        fields(parent).value = readCall(lift);
        return;
      }
      if (
        (parent.type === 'ObjectProperty' || parent.type === 'Property') &&
        key === 'key' &&
        fields(parent).computed !== true
      ) {
        return;
      }
      replaceAt(parent, key, index, readCall(lift) as unknown as BaseNode);
    },
    leave(current) {
      if (current.type.startsWith('TS')) typeDepth--;
    },
  });

  refreshAstAnalysis(ctx, program);

  const writeCall = (
    lift: CellLift,
    current: BaseNode,
  ): t.CallExpression => {
    if (current.type === 'AssignmentExpression') {
      const right = childNode(current, 'right')! as unknown as t.Expression;
      const operator = fields(current).operator;
      if (operator === '=') {
        return callExpression(md(ctx, 'setCell'), [
          t.identifier(lift.cellId),
          cloneNode(right),
        ]);
      }
      const compound =
        typeof operator === 'string' ? compoundOperator(operator) : null;
      if (compound === null) {
        throw new Error(
          `memo-dom: unsupported compound write '${String(operator)}' on module state '${lift.local}'`,
        );
      }
      return callExpression(md(ctx, 'updateCell'), [
        t.identifier(lift.cellId),
        t.arrowFunctionExpression(
          [t.identifier('c')],
          binaryExpression(compound, t.identifier('c'), cloneNode(right)),
        ),
      ]);
    }
    const delta = fields(current).operator === '--' ? '-' : '+';
    return callExpression(md(ctx, 'updateCell'), [
      t.identifier(lift.cellId),
      t.arrowFunctionExpression(
        [t.identifier('c')],
        binaryExpression(delta, t.identifier('c'), t.numericLiteral(1)),
      ),
    ]);
  };

  walkAst<BaseNode>(program, {
    enter(current, parent, key, index) {
      if (
        (current.type !== 'AssignmentExpression' &&
          current.type !== 'UpdateExpression') ||
        parent === null ||
        key === undefined
      ) {
        return;
      }
      const target = childNode(
        current,
        current.type === 'AssignmentExpression' ? 'left' : 'argument',
      );
      if (target?.type !== 'Identifier') return;
      const lift = matchesLift(target);
      if (lift === undefined) return;
      if (parent.type !== 'ExpressionStatement') {
        throw programPath.buildCodeFrameError(
          current.type === 'AssignmentExpression'
            ? `memo-dom: module-state write '${lift.local}' must be a statement; value-producing assignments cannot lower to state cells`
            : `memo-dom: module-state update '${lift.local}' must be a statement; its produced value cannot lower to state cells`,
        );
      }
      replaceAt(parent, key, index, writeCall(lift, current) as unknown as BaseNode);
      return false;
    },
  });
  refreshAstAnalysis(ctx, program);
}
