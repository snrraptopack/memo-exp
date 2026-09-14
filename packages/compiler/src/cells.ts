/** Request-owned module state-cell lowering for server builds. */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  asNode as node,
  childNode,
  childNodes,
  cloneNode as cloneAstNode,
  identifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Binding,
} from './ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  unwrapTypeExpression,
  variableDeclaratorFor,
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

function returnStatement(argument: t.Expression): t.ReturnStatement {
  return { type: 'ReturnStatement', argument } as t.ReturnStatement;
}

function literalValue(value: BaseNode): unknown {
  return fields(value).value;
}

function isDeepLiteral(current: BaseNode): boolean {
  if (
    current.type === 'TSAsExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSInstantiationExpression'
  ) {
    const expression = childNode(current, 'expression');
    return expression !== null && isDeepLiteral(expression);
  }
  if (current.type === 'NullLiteral') return true;
  if (
    current.type === 'StringLiteral' ||
    current.type === 'NumericLiteral' ||
    current.type === 'BooleanLiteral' ||
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

/**
 * Whether the value produced by a write expression is consumed. Writes lower
 * to void runtime calls, so value-producing positions must be rejected. The
 * check climbs through comma sequences: only the last element's value
 * propagates to the sequence's own parent.
 */
function writeProducesValue(
  ctx: Ctx,
  node: BaseNode,
  parent: BaseNode,
): boolean {
  let current: BaseNode = node;
  let owner: BaseNode = parent;
  for (;;) {
    if (owner.type === 'ExpressionStatement') return false;
    if (owner.type === 'ForStatement') {
      return !(
        childNode(owner, 'init') === current ||
        childNode(owner, 'update') === current
      );
    }
    if (owner.type !== 'SequenceExpression') return true;
    const elements = fields(owner).expressions;
    if (Array.isArray(elements) && elements[elements.length - 1] !== current) {
      return false;
    }
    const ancestor = ctx.astAnalysis?.parentByNode.get(owner);
    if (ancestor === undefined || ancestor === null) return true;
    current = owner;
    owner = ancestor;
  }
}

/**
 * Whether the identifier sits inside a destructuring pattern used as a write
 * target (`({a} = obj)`, `[a] = arr`, `for ({a} of xs)`). Pattern leaves are
 * binding positions, not reads — replacing them with call expressions would
 * emit invalid syntax.
 */
function insidePatternWriteTarget(
  ctx: Ctx,
  node: BaseNode,
  parent: BaseNode,
  key: string,
): boolean {
  let current: BaseNode = node;
  let owner: BaseNode = parent;
  let ownerKey: string | undefined = key;
  let climbed = false;
  for (;;) {
    if (
      owner.type === 'ObjectPattern' ||
      owner.type === 'ArrayPattern' ||
      owner.type === 'AssignmentPattern' ||
      owner.type === 'RestElement' ||
      ((owner.type === 'ObjectProperty' || owner.type === 'Property') &&
        ownerKey === 'value')
    ) {
      const next = ctx.astAnalysis?.parentByNode.get(owner);
      if (next === undefined || next === null) return false;
      current = owner;
      owner = next;
      ownerKey = undefined;
      climbed = true;
      continue;
    }
    // A bare identifier directly in the write position is not a pattern.
    if (!climbed) return false;
    if (owner.type === 'AssignmentExpression') {
      return childNode(owner, 'left') === current;
    }
    if (owner.type === 'ForOfStatement' || owner.type === 'ForInStatement') {
      return childNode(owner, 'left') === current;
    }
    return false;
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
      const rawInitializer = childNode(declarator, 'init');
      const initializer = rawInitializer === null
        ? null
        : unwrapTypeExpression(rawInitializer);
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
    const arguments_: t.Expression[] = [astFactory.stringLiteral(lift.key)];
    if (lift.owned) {
      const declarator = variableDeclaratorFor(ctx, lift.binding);
      const initializer =
        declarator === null ? null : childNode(declarator, 'init');
      if (initializer !== null) {
        const cloned = cloneNode(initializer as unknown as t.Expression);
        arguments_.push(
          lift.kind === 'store'
            ? astFactory.arrowFunctionExpression(
                [],
                astFactory.blockStatement([returnStatement(cloned)]),
              )
            : cloned,
        );
      }
    }
    ctx.header.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(lift.cellId),
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
    callExpression(md(ctx, 'readCell'), [astFactory.identifier(lift.cellId)]);

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
      if (insidePatternWriteTarget(ctx, current, parent, key)) {
        throw programPath.buildCodeFrameError(
          `memo-dom: destructuring writes to module state '${lift.local}' are not supported in server builds; assign '${lift.local}' directly`,
        );
      }
      if (
        (parent.type === 'VariableDeclarator' && key === 'id') ||
        ((parent.type === 'MemberExpression' ||
          parent.type === 'OptionalMemberExpression') &&
          key === 'property' &&
          fields(parent).computed !== true) ||
        (key === 'key' && fields(parent).computed !== true) ||
        parent.type === 'ExportSpecifier' ||
        parent.type.startsWith('Import') ||
        ((parent.type === 'AssignmentExpression' && key === 'left') ||
          (parent.type === 'UpdateExpression' && key === 'argument')) ||
        ((parent.type === 'ForOfStatement' ||
          parent.type === 'ForInStatement') &&
          key === 'left') ||
        ((parent.type === 'LabeledStatement' ||
          parent.type === 'BreakStatement' ||
          parent.type === 'ContinueStatement') &&
          key === 'label')
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
      replaceAt(parent, key, index, readCall(lift) as unknown as BaseNode);
    },
    leave(current) {
      if (current.type.startsWith('TS')) typeDepth--;
    },
  });

  refreshAstAnalysis(ctx, program);

  const cellById = new Map<string, CellLift>();
  for (const lift of lifts.values()) cellById.set(lift.cellId, lift);
  const isCellRead = (value: BaseNode): CellLift | undefined => {
    if (value.type !== 'CallExpression') return undefined;
    const callee = childNode(value, 'callee');
    const args = childNodes(value, 'arguments');
    if (
      callee?.type !== 'MemberExpression' ||
      identifierName(childNode(callee, 'property')) !== 'readCell' ||
      args.length !== 1 ||
      args[0]!.type !== 'Identifier'
    ) {
      return undefined;
    }
    return cellById.get(identifierName(args[0])!);
  };
  /**
   * Pass 1 already rewrote a member root (`store.x` → `readCell(_c_store).x`),
   * so a write target's member chain bottoms out at the readCell call for the
   * lifted binding.
   */
  const cellReadAtMemberRoot = (
    target: BaseNode,
  ): { lift: CellLift; call: BaseNode } | null => {
    let current = target;
    for (;;) {
      const lift = isCellRead(current);
      if (lift !== undefined) return { lift, call: current };
      if (
        current.type === 'MemberExpression' ||
        current.type === 'OptionalMemberExpression'
      ) {
        const object = childNode(current, 'object');
        if (object === null) return null;
        current = object;
        continue;
      }
      if (current.type.startsWith('TS')) {
        const inner = childNode(current, 'expression');
        if (inner === null) return null;
        current = inner;
        continue;
      }
      return null;
    }
  };
  const replaceCellRead = (
    root: BaseNode,
    lift: CellLift,
    replacement: t.Identifier,
  ): void => {
    walkAst<BaseNode>(root, {
      enter(value, valueParent, valueKey, valueIndex) {
        if (valueParent === null || valueKey === undefined) return;
        if (isCellRead(value)?.cellId === lift.cellId) {
          replaceAt(
            valueParent,
            valueKey,
            valueIndex,
            replacement as unknown as BaseNode,
          );
          return false;
        }
      },
    });
  };

  const writeCall = (
    lift: CellLift,
    current: BaseNode,
  ): t.CallExpression => {
    const operator = fields(current).operator;
    if (current.type === 'UpdateExpression') {
      return callExpression(md(ctx, 'updateCell'), [
        astFactory.identifier(lift.cellId),
        astFactory.arrowFunctionExpression(
          [astFactory.identifier('c')],
          astFactory.sequenceExpression([
            astFactory.updateExpression(
              operator as t.UpdateExpression['operator'],
              astFactory.identifier('c'),
              true,
            ),
            astFactory.identifier('c'),
          ]),
        ),
      ]);
    }
    const right = childNode(current, 'right')! as unknown as t.Expression;
    if (operator === '=') {
      return callExpression(md(ctx, 'setCell'), [
        astFactory.identifier(lift.cellId),
        cloneNode(right),
      ]);
    }
    // `updateCell` commits through the access table. `(c <op>= right, c)`
    // applies any compound operator — including `??=`, `**=`, `%=`, … — and
    // returns the updated value so the slot stays consistent.
    return callExpression(md(ctx, 'updateCell'), [
      astFactory.identifier(lift.cellId),
      astFactory.arrowFunctionExpression(
        [astFactory.identifier('c')],
        astFactory.sequenceExpression([
          astFactory.assignmentExpression(
            operator as t.AssignmentExpression['operator'],
            astFactory.identifier('c'),
            cloneNode(right),
          ),
          astFactory.identifier('c'),
        ]),
      ),
    ]);
  };

  walkAst<BaseNode>(program, {
    enter(current, parent, key, index) {
      if (parent === null || key === undefined) return;

      // `for (x of …)` / `for (x in …)` with a module-state loop target: the
      // binding itself is rewritten, so lower the loop to assign through the
      // cell on every iteration.
      if (
        current.type === 'ForOfStatement' ||
        current.type === 'ForInStatement'
      ) {
        const left = childNode(current, 'left');
        if (left?.type !== 'Identifier') return;
        const lift = matchesLift(left);
        if (lift === undefined) return;
        const loopValue = generatedIdentifier(ctx, 'forValue');
        const body = childNode(current, 'body');
        const setStatement = astFactory.expressionStatement(
          callExpression(md(ctx, 'setCell'), [
            astFactory.identifier(lift.cellId),
            astFactory.identifier(loopValue.name),
          ]),
        );
        fields(current).left = astFactory.variableDeclaration('const', [
          astFactory.variableDeclarator(astFactory.identifier(loopValue.name)),
        ]);
        fields(current).body = astFactory.blockStatement([
          setStatement,
          ...(body !== null && body.type === 'BlockStatement'
            ? childNodes(body, 'body')
            : body === null
              ? []
              : [body]),
        ] as t.Statement[]);
        return;
      }

      const isDelete =
        current.type === 'UnaryExpression' &&
        fields(current).operator === 'delete';
      if (
        current.type !== 'AssignmentExpression' &&
        current.type !== 'UpdateExpression' &&
        !isDelete
      ) {
        return;
      }
      const target = childNode(
        current,
        current.type === 'AssignmentExpression' ? 'left' : 'argument',
      );
      if (target === null) return;

      if (target.type === 'Identifier') {
        const lift = matchesLift(target);
        if (lift === undefined) return;
        if (isDelete) {
          // `delete x` on a bare binding is rejected by strict-mode parsers;
          // nothing to lower.
          return;
        }
        if (writeProducesValue(ctx, current, parent)) {
          throw programPath.buildCodeFrameError(
            current.type === 'AssignmentExpression'
              ? `memo-dom: module-state write '${lift.local}' cannot produce a value; state cells only support statement-position writes`
              : `memo-dom: module-state update '${lift.local}' cannot produce a value; state cells only support statement-position updates`,
          );
        }
        replaceAt(parent, key, index, writeCall(lift, current) as unknown as BaseNode);
        return false;
      }

      // Member/delete targets rooted at a cell read: `readCell(c).x = v`.
      // Lower to `updateCell(c, (slot) => (slot.x = v, slot))` so the mutation
      // still routes invalidation through the access table.
      const member = cellReadAtMemberRoot(target);
      if (member === null) return;
      if (writeProducesValue(ctx, current, parent)) {
        throw programPath.buildCodeFrameError(
          `memo-dom: module-state write to '${member.lift.local}' cannot produce a value; state cells only support statement-position writes`,
        );
      }
      const loweredTarget = cloneNode(target) as unknown as t.Expression;
      replaceCellRead(
        loweredTarget as unknown as BaseNode,
        member.lift,
        astFactory.identifier('c'),
      );
      const applied: t.Expression =
        current.type === 'AssignmentExpression'
          ? astFactory.assignmentExpression(
              fields(current).operator as t.AssignmentExpression['operator'],
              loweredTarget as t.MemberExpression,
              cloneNode(childNode(current, 'right')! as unknown as t.Expression),
            )
          : isDelete
            ? astFactory.unaryExpression('delete', loweredTarget, true)
            : astFactory.updateExpression(
                fields(current).operator as t.UpdateExpression['operator'],
                loweredTarget,
                fields(current).prefix === true,
              );
      replaceAt(
        parent,
        key,
        index,
        callExpression(md(ctx, 'updateCell'), [
          astFactory.identifier(member.lift.cellId),
          astFactory.arrowFunctionExpression(
            [astFactory.identifier('c')],
            astFactory.sequenceExpression([
              applied,
              astFactory.identifier('c'),
            ]),
          ),
        ]) as unknown as BaseNode,
      );
      return false;
    },
  });
  refreshAstAnalysis(ctx, program);
}
