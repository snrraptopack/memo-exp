import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  ESTREE_VISITOR_KEYS,
  extractPatternIdentifiers,
  walkAst,
  type BaseNode,
} from '../ast';

type Fail = (message: string, at?: t.Node) => never;

interface RowDerivation {
  name: string;
  init: t.Expression;
}

function defaultedRowProjection(
  projection: t.Expression,
  fallback: t.Expression,
): t.Expression {
  return astFactory.conditionalExpression(
    astFactory.binaryExpression(
      '===',
      cloneEstreeNode(projection, true),
      astFactory.unaryExpression('void', astFactory.numericLiteral(0)),
    ),
    cloneEstreeNode(fallback, true),
    projection,
  );
}

function rowMemberProjection(
  source: t.Expression,
  key: t.Expression,
  computed: boolean,
): t.Expression {
  return astFactory.memberExpression(
    cloneEstreeNode(source, true),
    cloneEstreeNode(key, true),
    computed || !astFactory.isIdentifier(key),
  );
}

function decomposeRowPattern(
  pattern: BaseNode,
  source: t.Expression,
  output: RowDerivation[],
  fail: Fail,
): void {
  if (astFactory.isIdentifier(pattern)) {
    output.push({ name: pattern.name, init: source });
    return;
  }
  if (astFactory.isAssignmentPattern(pattern)) {
    decomposeRowPattern(
      pattern.left,
      defaultedRowProjection(source, pattern.right),
      output,
      fail,
    );
    return;
  }
  if (astFactory.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (astFactory.isRestElement(property)) {
        fail(
          'memo-dom: object rest in a list const destructuring declaration is not supported; destructure in the callback parameter or read the required properties explicitly — R7 L1',
        );
      }
      if (!astFactory.isObjectProperty(property)) {
        fail('memo-dom: unsupported list const destructuring property — R7 L1');
      }
      decomposeRowPattern(
        property.value as unknown as BaseNode,
        rowMemberProjection(source, property.key, property.computed),
        output,
        fail,
      );
    }
    return;
  }
  if (astFactory.isArrayPattern(pattern)) {
    for (let index = 0; index < pattern.elements.length; index++) {
      const element = pattern.elements[index];
      if (element === null) continue;
      if (astFactory.isRestElement(element)) {
        if (!astFactory.isIdentifier(element.argument)) {
          fail('memo-dom: nested array rest patterns are not supported in list const destructuring — R7 L1');
        }
        output.push({
          name: element.argument.name,
          init: astFactory.callExpression(
            astFactory.memberExpression(
              cloneEstreeNode(source, true),
              astFactory.identifier('slice'),
            ),
            [astFactory.numericLiteral(index)],
          ),
        });
        continue;
      }
      decomposeRowPattern(
        element as unknown as BaseNode,
        rowMemberProjection(
          source,
          astFactory.numericLiteral(index),
          true,
        ),
        output,
        fail,
      );
    }
    return;
  }
  fail('memo-dom: unsupported list const destructuring target — R7 L1');
}

export function collectRowDerivations(
  statements: t.Statement[],
  reserved: ReadonlySet<string>,
  fail: Fail,
): RowDerivation[] {
  const derivations: RowDerivation[] = [];
  for (const statement of statements) {
    const declaration =
      astFactory.isVariableDeclaration(statement) &&
      statement.kind === 'const' &&
      statement.declarations.length === 1
        ? statement.declarations[0]
        : null;
    if (
      declaration === undefined ||
      declaration === null ||
      (!astFactory.isIdentifier(declaration.id) &&
        !astFactory.isObjectPattern(declaration.id) &&
        !astFactory.isArrayPattern(declaration.id)) ||
      declaration.init == null ||
      !astFactory.isExpression(declaration.init)
    ) {
      return fail(
        'memo-dom: list callback statements before return must be one const declaration with an identifier, object pattern, or array pattern — R7 L1',
      );
    }
    walkAst(declaration.init as unknown as BaseNode, {
      enter(node) {
        const current = node as unknown as t.Node;
        if (
          astFactory.isAssignmentExpression(current) ||
          astFactory.isUpdateExpression(current) ||
          astFactory.isAwaitExpression(current) ||
          astFactory.isYieldExpression(current)
        ) {
          fail(
            'memo-dom: list callback derivations must be pure const expressions — R7 L1',
          );
        }
      },
    });
    const expanded: RowDerivation[] = [];
    decomposeRowPattern(
      declaration.id as unknown as BaseNode,
      declaration.init,
      expanded,
      fail,
    );
    for (const derivation of expanded) {
      if (reserved.has(derivation.name)) {
        return fail(
          `memo-dom: list callback derivation '${derivation.name}' shadows an item or index binding — R7 L1`,
        );
      }
      derivations.push(derivation);
    }
  }
  return derivations;
}

export function assertNoShadowing(
  root: t.Node,
  names: ReadonlySet<string>,
  fail: Fail,
): void {
  if (names.size === 0) return;
  const checkParams = (params: readonly t.Node[]): void => {
    for (const parameter of params) {
      for (const { name } of extractPatternIdentifiers(
        parameter as unknown as BaseNode,
      )) {
        if (names.has(name)) {
          fail(
            `memo-dom: list callback derivation '${name}' is shadowed inside the row JSX — R7 L1`,
          );
        }
      }
    }
  };
  walkAst(root as unknown as BaseNode, {
    enter(node) {
      const current = node as unknown as t.Node;
      if (astFactory.isFunction(current)) {
        checkParams(current.params);
      }
      if (
        astFactory.isVariableDeclarator(current) &&
        astFactory.isIdentifier(current.id) &&
        names.has(current.id.name)
      ) {
        fail(
          `memo-dom: list callback derivation '${current.id.name}' is shadowed inside the row JSX — R7 L1`,
        );
      }
    },
  });
}

/**
 * Replace references to resolved derivations throughout an expression.
 * Reference positions are tracked so member property names, object keys,
 * and function parameters keep their identifiers. Every inserted
 * initializer is a fresh deep clone.
 */
export function substituteRowDerivations<T extends t.Node>(
  node: T,
  resolved: ReadonlyMap<string, t.Expression>,
): T {
  if (resolved.size === 0) return node;
  return substituteNode(node, resolved, true);
}

function substituteNode<T extends t.Node>(
  node: T,
  resolved: ReadonlyMap<string, t.Expression>,
  reference: boolean,
): T {
  if (astFactory.isIdentifier(node)) {
    if (reference && resolved.has(node.name)) {
      return cloneEstreeNode(resolved.get(node.name)!, true) as unknown as T;
    }
    return node;
  }
  if (astFactory.isMemberExpression(node) || astFactory.isOptionalMemberExpression(node)) {
    const next = cloneEstreeNode(node, false);
    next.object = substituteNode(node.object, resolved, true) as typeof next.object;
    if (node.computed) {
      next.property = substituteNode(
        node.property as t.Expression,
        resolved,
        true,
      ) as typeof next.property;
    }
    return next;
  }
  if (astFactory.isObjectProperty(node) && node.shorthand && astFactory.isIdentifier(node.key)) {
    const next = cloneEstreeNode(node, false);
    next.value = substituteNode(
      node.value as t.Expression,
      resolved,
      true,
    ) as typeof next.value;
    next.shorthand = false;
    return next;
  }
  if (astFactory.isFunction(node)) {
    const next = cloneEstreeNode(node, false);
    next.params = node.params.map((parameter) =>
      cloneEstreeNode(parameter, true),
    );
    next.body = substituteNode(node.body, resolved, true);
    return next;
  }
  const next = cloneEstreeNode(node, false);
  const source = node as unknown as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
    const child = source[key];
    if (Array.isArray(child)) {
      target[key] = child.map((entry) =>
        entry === null || typeof entry !== 'object' || !('type' in entry)
          ? entry
          : substituteNode(entry as t.Node, resolved, true),
      );
    } else if (
      child !== null &&
      typeof child === 'object' &&
      'type' in child
    ) {
      target[key] = substituteNode(child as t.Node, resolved, true);
    }
  }
  return next;
}
