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
  const checkNames = (
    pattern: t.Node | BaseNode | null | undefined,
    kind: string,
  ): void => {
    if (pattern === null || pattern === undefined) return;
    for (const { name } of extractPatternIdentifiers(
      pattern as unknown as BaseNode,
    )) {
      if (names.has(name)) {
        fail(
          `memo-dom: list callback derivation '${name}' is ${kind} inside the row JSX — R7 L1`,
        );
      }
    }
  };
  walkAst(root as unknown as BaseNode, {
    enter(node) {
      const current = node as unknown as t.Node;
      if (astFactory.isFunction(current)) {
        for (const parameter of current.params) {
          checkNames(parameter as unknown as BaseNode, 'shadowed');
        }
        // A named function expression/declaration id is itself a binding.
        const id = (current as { id?: t.Node | null }).id;
        if (id !== null && id !== undefined) {
          checkNames(id as unknown as BaseNode, 'shadowed');
        }
      }
      if (
        astFactory.isClassDeclaration(current) ||
        current.type === 'ClassExpression'
      ) {
        const id = (current as { id?: t.Node | null }).id;
        if (id !== null && id !== undefined) {
          checkNames(id as unknown as BaseNode, 'shadowed');
        }
      }
      if (astFactory.isVariableDeclarator(current)) {
        checkNames(current.id as unknown as BaseNode, 'shadowed');
      }
      if (current.type === 'CatchClause') {
        checkNames(
          (current as { param?: t.Node | null }).param as
            | BaseNode
            | null
            | undefined,
          'shadowed',
        );
      }
      if (
        astFactory.isAssignmentExpression(current) ||
        astFactory.isUpdateExpression(current)
      ) {
        const target = astFactory.isAssignmentExpression(current)
          ? current.left
          : current.argument;
        checkNames(target as unknown as BaseNode, 'reassigned');
      }
      if (
        current.type === 'ForInStatement' ||
        current.type === 'ForOfStatement'
      ) {
        const left = (current as { left?: t.Node }).left;
        if (left !== undefined && astFactory.isVariableDeclaration(left)) {
          for (const declaration of left.declarations) {
            checkNames(declaration.id as unknown as BaseNode, 'shadowed');
          }
        } else if (left !== undefined) {
          checkNames(left as unknown as BaseNode, 'reassigned');
        }
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

function substitutePattern<T extends t.Node>(
  pattern: T,
  resolved: ReadonlyMap<string, t.Expression>,
): T {
  // Binding identifiers are never substituted. Evaluated positions inside a
  // pattern — defaults, computed keys, member bases — may still reference
  // derivations and must be substituted.
  if (
    astFactory.isIdentifier(pattern) ||
    astFactory.isMemberExpression(pattern) ||
    astFactory.isOptionalMemberExpression(pattern)
  ) {
    if (astFactory.isIdentifier(pattern)) return pattern;
    const next = cloneEstreeNode(pattern, false);
    next.object = substituteNode(
      pattern.object as t.Expression,
      resolved,
      true,
    ) as typeof next.object;
    if (pattern.computed) {
      next.property = substituteNode(
        pattern.property as t.Expression,
        resolved,
        true,
      ) as typeof next.property;
    }
    return next;
  }
  if (astFactory.isAssignmentPattern(pattern)) {
    const next = cloneEstreeNode(pattern, false);
    next.left = substitutePattern(pattern.left, resolved) as typeof next.left;
    next.right = substituteNode(
      pattern.right,
      resolved,
      true,
    ) as typeof next.right;
    return next;
  }
  if (astFactory.isRestElement(pattern)) {
    const next = cloneEstreeNode(pattern, false);
    next.argument = substitutePattern(
      pattern.argument,
      resolved,
    ) as typeof next.argument;
    return next;
  }
  if (astFactory.isObjectPattern(pattern)) {
    const next = cloneEstreeNode(pattern, false);
    next.properties = pattern.properties.map((property) => {
      if (astFactory.isRestElement(property)) {
        return substitutePattern(property, resolved);
      }
      if (!astFactory.isObjectProperty(property)) return property;
      const nextProperty = cloneEstreeNode(property, false);
      nextProperty.key = property.computed
        ? (substituteNode(
            property.key as t.Expression,
            resolved,
            true,
          ) as typeof nextProperty.key)
        : property.key;
      nextProperty.value = substitutePattern(
        property.value as unknown as t.Node,
        resolved,
      ) as typeof nextProperty.value;
      return nextProperty;
    }) as typeof next.properties;
    return next;
  }
  if (astFactory.isArrayPattern(pattern)) {
    const next = cloneEstreeNode(pattern, false);
    next.elements = pattern.elements.map(
      (element) =>
        element === null
          ? null
          : substitutePattern(element as t.Node, resolved),
    ) as typeof next.elements;
    return next;
  }
  return pattern;
}

/** Child keys that hold binding or label positions rather than references. */
const NON_REFERENCE_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['LabeledStatement', new Set(['label'])],
  ['BreakStatement', new Set(['label'])],
  ['ContinueStatement', new Set(['label'])],
  ['FunctionDeclaration', new Set(['id'])],
  ['FunctionExpression', new Set(['id'])],
  ['ClassDeclaration', new Set(['id'])],
  ['ClassExpression', new Set(['id'])],
]);

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
  if (astFactory.isObjectProperty(node)) {
    const next = cloneEstreeNode(node, false);
    next.key = node.computed
      ? (substituteNode(
          node.key as t.Expression,
          resolved,
          true,
        ) as typeof next.key)
      : node.key;
    next.value = substituteNode(
      node.value as t.Expression,
      resolved,
      true,
    ) as typeof next.value;
    if (node.shorthand) next.shorthand = false;
    return next;
  }
  if (node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') {
    const source = node as unknown as {
      computed: boolean;
      key: t.Node;
      value: t.Node | null;
    };
    const next = cloneEstreeNode(node, false) as unknown as {
      computed: boolean;
      key: t.Node;
      value: t.Node | null;
    };
    next.key = source.computed
      ? substituteNode(source.key, resolved, true)
      : source.key;
    next.value =
      source.value === null
        ? null
        : substituteNode(source.value, resolved, true);
    return next as unknown as T;
  }
  if (astFactory.isFunction(node)) {
    const next = cloneEstreeNode(node, false);
    // The function name is a binding; parameters bind their pattern
    // positions while defaults remain evaluated expressions.
    if ('id' in next && 'id' in node) {
      (next as { id: unknown }).id = node.id;
    }
    next.params = node.params.map((parameter) =>
      substitutePattern(parameter, resolved),
    ) as typeof next.params;
    next.body = substituteNode(node.body, resolved, true);
    return next;
  }
  if (astFactory.isVariableDeclarator(node)) {
    const next = cloneEstreeNode(node, false);
    next.id = substitutePattern(node.id, resolved) as typeof next.id;
    next.init =
      node.init == null
        ? null
        : (substituteNode(node.init, resolved, true) as typeof next.init);
    return next;
  }
  if (node.type === 'CatchClause') {
    const next = cloneEstreeNode(node, false) as unknown as {
      param?: t.Node | null;
      body: t.Node;
    };
    const param = (node as unknown as { param?: t.Node | null }).param;
    next.param =
      param === null || param === undefined
        ? param
        : substitutePattern(param, resolved);
    next.body = substituteNode(
      (node as unknown as { body: t.Node }).body,
      resolved,
      true,
    );
    return next as unknown as T;
  }
  if (
    node.type === 'ForInStatement' ||
    node.type === 'ForOfStatement'
  ) {
    const next = cloneEstreeNode(node, false) as unknown as {
      left: t.Node;
      right: t.Node;
      body: t.Node;
    };
    const source = node as unknown as {
      left: t.Node;
      right: t.Node;
      body: t.Node;
    };
    next.left = astFactory.isVariableDeclaration(source.left)
      ? substituteNode(source.left, resolved, true)
      : substitutePattern(source.left, resolved);
    next.right = substituteNode(source.right, resolved, true);
    next.body = substituteNode(source.body, resolved, true);
    return next as unknown as T;
  }
  const next = cloneEstreeNode(node, false);
  const source = node as unknown as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  const nonReference = NON_REFERENCE_KEYS.get(node.type);
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
      target[key] =
        nonReference !== undefined && nonReference.has(key)
          ? child
          : substituteNode(child as t.Node, resolved, true);
    }
  }
  return next;
}
