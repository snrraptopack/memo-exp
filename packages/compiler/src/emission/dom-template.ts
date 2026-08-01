/**
 * Lazy static DOM templates for allocation-free listed components.
 *
 * Listed rows are mounted many times. Their static host structure is built
 * once, retained as a detached pristine node, and deep-cloned per row. Dynamic
 * setters and event/ref/lifecycle work remain in the row factory.
 */

import * as t from '@babel/types';
import { walkNodes, type Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import type { EmitScope } from './scope';

interface NodeFactory {
  name: string;
  statement: t.VariableDeclaration;
}

interface ParentLink {
  index: number;
  parent: string;
}

const STATIC_RUNTIME_SETTERS = new Set([
  'setClassValue',
  'setStyleValue',
  'setDomValue',
]);

export function applyRepeatedDomTemplate(
  ctx: Ctx,
  scope: EmitScope,
  rootVar: string,
): boolean {
  if (
    scope.mounts.length !== 0 ||
    scope.disposableRegions.length !== 0 ||
    scope.disposableEntities.length !== 0 ||
    scope.disposableCallbacks.length !== 0
  ) {
    return false;
  }

  const factories: NodeFactory[] = [];
  const nodeNames = new Set<string>();
  for (const statement of scope.creation) {
    if (!t.isVariableDeclaration(statement)) continue;
    const factory = readNodeFactory(statement);
    if (factory === null) return false;
    factories.push(factory);
    nodeNames.add(factory.name);
  }
  if (!nodeNames.has(rootVar) || factories.length < 2) return false;

  const links = new Map<string, ParentLink>();
  const childCounts = new Map<string, number>();
  for (const statement of scope.creation) {
    const append = readAppend(statement);
    if (append === null) continue;
    if (!nodeNames.has(append.parent) || !nodeNames.has(append.child)) {
      return false;
    }
    const index = childCounts.get(append.parent) ?? 0;
    childCounts.set(append.parent, index + 1);
    links.set(append.child, { parent: append.parent, index });
  }

  const paths = new Map<string, number[]>();
  for (const name of nodeNames) {
    const path = pathFromRoot(name, rootVar, links);
    if (path === null) return false;
    paths.set(name, path);
  }

  const templateStatements: t.Statement[] = [];
  const retained: t.Statement[] = [];
  for (const statement of scope.creation) {
    if (
      t.isVariableDeclaration(statement) ||
      isStaticTemplateOperation(statement, nodeNames)
    ) {
      templateStatements.push(t.cloneNode(statement, true));
    } else {
      retained.push(statement);
    }
  }

  const template = generatedIdentifier(ctx, `${rootVar}Template`);
  ctx.header.push(
    t.variableDeclaration('let', [
      t.variableDeclarator(t.cloneNode(template)),
    ]),
  );

  const initializeTemplate = t.callExpression(
    t.arrowFunctionExpression(
      [],
      t.blockStatement([
        ...templateStatements,
        t.returnStatement(t.identifier(rootVar)),
      ]),
    ),
    [],
  );
  const getTemplate = t.conditionalExpression(
    t.binaryExpression(
      '===',
      t.cloneNode(template),
      t.unaryExpression('void', t.numericLiteral(0)),
    ),
    t.assignmentExpression(
      '=',
      t.cloneNode(template),
      initializeTemplate,
    ),
    t.cloneNode(template),
  );
  const rootClone = t.callExpression(
    t.memberExpression(getTemplate, t.identifier('cloneNode')),
    [t.booleanLiteral(true)],
  );

  const referencedNodes = new Set<string>([rootVar]);
  for (const statement of retained) {
    walkNodes(statement, (node) => {
      if (t.isIdentifier(node) && nodeNames.has(node.name)) {
        referencedNodes.add(node.name);
      }
    });
  }
  const bound: Array<{ name: string; path: number[] }> = [];
  const bindings = factories
    .filter(({ name }) => referencedNodes.has(name))
    .sort(
      (left, right) =>
        paths.get(left.name)!.length - paths.get(right.name)!.length,
    )
    .map(({ name }) => {
      const path = paths.get(name)!;
      let value: t.Expression;
      if (name === rootVar) {
        value = t.cloneNode(rootClone, true);
      } else {
        let base = bound[0]!;
        for (const candidate of bound) {
          if (
            candidate.path.length > base.path.length &&
            isPathPrefix(candidate.path, path)
          ) {
            base = candidate;
          }
        }
        value = nodeAtPath(base.name, path.slice(base.path.length));
      }
      bound.push({ name, path });
      return t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(name),
          value,
        ),
      ]);
    });

  scope.creation = [...bindings, ...retained];
  return true;
}

function isPathPrefix(
  prefix: readonly number[],
  path: readonly number[],
): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((segment, index) => path[index] === segment)
  );
}

function readNodeFactory(
  statement: t.VariableDeclaration,
): NodeFactory | null {
  if (statement.declarations.length !== 1) return null;
  const declaration = statement.declarations[0]!;
  if (
    !t.isIdentifier(declaration.id) ||
    !t.isCallExpression(declaration.init) ||
    !t.isMemberExpression(declaration.init.callee) ||
    !t.isIdentifier(declaration.init.callee.object, { name: 'document' }) ||
    !t.isIdentifier(declaration.init.callee.property)
  ) {
    return null;
  }
  const method = declaration.init.callee.property.name;
  if (
    method !== 'createElement' &&
    method !== 'createElementNS' &&
    method !== 'createTextNode'
  ) {
    return null;
  }
  const tag = declaration.init.arguments.at(-1);
  if (
    (method === 'createElement' || method === 'createElementNS') &&
    t.isStringLiteral(tag) &&
    tag.value.includes('-')
  ) {
    return null;
  }
  return { name: declaration.id.name, statement };
}

function readAppend(
  statement: t.Statement,
): { child: string; parent: string } | null {
  if (
    !t.isExpressionStatement(statement) ||
    !t.isCallExpression(statement.expression) ||
    !t.isMemberExpression(statement.expression.callee) ||
    !t.isIdentifier(statement.expression.callee.object) ||
    !t.isIdentifier(statement.expression.callee.property, {
      name: 'appendChild',
    }) ||
    statement.expression.arguments.length !== 1 ||
    !t.isIdentifier(statement.expression.arguments[0])
  ) {
    return null;
  }
  return {
    parent: statement.expression.callee.object.name,
    child: statement.expression.arguments[0].name,
  };
}

function pathFromRoot(
  name: string,
  root: string,
  links: ReadonlyMap<string, ParentLink>,
): number[] | null {
  if (name === root) return [];
  const reversed: number[] = [];
  const seen = new Set<string>();
  let current = name;
  while (current !== root) {
    if (seen.has(current)) return null;
    seen.add(current);
    const link = links.get(current);
    if (link === undefined) return null;
    reversed.push(link.index);
    current = link.parent;
  }
  reversed.reverse();
  return reversed;
}

function nodeAtPath(root: string, path: readonly number[]): t.Expression {
  let current: t.Expression = t.identifier(root);
  for (const index of path) {
    current = t.memberExpression(current, t.identifier('firstChild'));
    for (let sibling = 0; sibling < index; sibling++) {
      current = t.memberExpression(current, t.identifier('nextSibling'));
    }
  }
  return current;
}

function isStaticTemplateOperation(
  statement: t.Statement,
  nodes: ReadonlySet<string>,
): boolean {
  const append = readAppend(statement);
  if (append !== null) {
    return nodes.has(append.parent) && nodes.has(append.child);
  }
  if (!t.isExpressionStatement(statement)) return false;
  const expression = statement.expression;

  if (
    t.isCallExpression(expression) &&
    t.isMemberExpression(expression.callee)
  ) {
    if (
      t.isIdentifier(expression.callee.object) &&
      nodes.has(expression.callee.object.name) &&
      t.isIdentifier(expression.callee.property, { name: 'setAttribute' }) &&
      expression.arguments.every(
        (argument) => t.isExpression(argument) && isStaticValue(argument),
      )
    ) {
      return true;
    }
    if (
      t.isIdentifier(expression.callee.object) &&
      t.isIdentifier(expression.callee.property) &&
      STATIC_RUNTIME_SETTERS.has(expression.callee.property.name) &&
      expression.arguments.length >= 2 &&
      t.isIdentifier(expression.arguments[0]) &&
      nodes.has(expression.arguments[0].name) &&
      expression.arguments
        .slice(1)
        .every(
          (argument) => t.isExpression(argument) && isStaticValue(argument),
        )
    ) {
      return true;
    }
  }
  return false;
}

function isStaticValue(expression: t.Expression): boolean {
  if (
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    t.isBooleanLiteral(expression) ||
    t.isNullLiteral(expression)
  ) {
    return true;
  }
  if (t.isArrayExpression(expression)) {
    return expression.elements.every(
      (element) => element === null || (t.isExpression(element) && isStaticValue(element)),
    );
  }
  if (t.isObjectExpression(expression)) {
    return expression.properties.every(
      (property) =>
        t.isObjectProperty(property) &&
        !property.computed &&
        t.isExpression(property.value) &&
        isStaticValue(property.value),
    );
  }
  return false;
}
