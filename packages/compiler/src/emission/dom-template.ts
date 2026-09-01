/**
 * Lazy static DOM templates for allocation-free listed components.
 *
 * Listed rows are mounted many times. Their static host structure is built
 * once, retained as a detached pristine node, and deep-cloned per row. Dynamic
 * setters and event/ref/lifecycle work remain in the row factory.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { walkNodes, type Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
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
  if (scope.documentVar === null) return false;

  const factories: NodeFactory[] = [];
  const nodeNames = new Set<string>();
  for (const statement of scope.creation) {
    if (!astFactory.isVariableDeclaration(statement)) continue;
    const factory = readNodeFactory(statement, scope.documentVar);
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
      astFactory.isVariableDeclaration(statement) ||
      isStaticTemplateOperation(statement, nodeNames)
    ) {
      templateStatements.push(cloneEstreeNode(statement, true));
    } else {
      retained.push(statement);
    }
  }

  const template = generatedIdentifier(ctx, `${rootVar}Template`);
  const templateDocument = generatedIdentifier(
    ctx,
    `${rootVar}TemplateDocument`,
  );
  const createTemplate = generatedIdentifier(
    ctx,
    `${rootVar}CreateTemplate`,
  );
  ctx.header.push(
    astFactory.variableDeclaration('let', [
      astFactory.variableDeclarator(cloneEstreeNode(template)),
      astFactory.variableDeclarator(cloneEstreeNode(templateDocument)),
    ]),
    // Keep the DOM constructor in one module-level function. Hydration needs
    // a fresh claim per row, while client-create caches its first result; an
    // inline constructor in both branches duplicates emitted code and static
    // creation work.
    astFactory.functionDeclaration(
      cloneEstreeNode(createTemplate),
      [astFactory.identifier(scope.documentVar)],
      astFactory.blockStatement([
        ...templateStatements,
        astFactory.returnStatement(astFactory.identifier(rootVar)),
      ]),
    ),
  );

  const initializeTemplate = astFactory.callExpression(
    cloneEstreeNode(createTemplate),
    [astFactory.identifier(scope.documentVar)],
  );
  // Hydrate mode must not clone: row factories claim their server nodes
  // through the document, and cloning a template built from the first claim
  // would recreate every subsequent row. Three-way emission: rebuild+cache
  // when allowed and stale; reuse when allowed and fresh; build fresh
  // WITHOUT caching in hydrate mode. The clone applies only when allowed.
  const canReuse = astFactory.callExpression(md(ctx, 'canReuseTemplate'), []);
  const getTemplate = astFactory.conditionalExpression(
    astFactory.logicalExpression(
      '&&',
      cloneEstreeNode(canReuse),
      astFactory.logicalExpression(
        '||',
        astFactory.binaryExpression(
          '===',
          cloneEstreeNode(template),
          astFactory.unaryExpression('void', astFactory.numericLiteral(0)),
        ),
        astFactory.binaryExpression(
          '!==',
          cloneEstreeNode(templateDocument),
          astFactory.identifier(scope.documentVar),
        ),
      ),
    ),
    astFactory.sequenceExpression([
      astFactory.assignmentExpression(
        '=',
        cloneEstreeNode(templateDocument),
        astFactory.identifier(scope.documentVar),
      ),
      astFactory.assignmentExpression(
        '=',
        cloneEstreeNode(template),
        initializeTemplate,
      ),
    ]),
    astFactory.conditionalExpression(
      cloneEstreeNode(canReuse),
      cloneEstreeNode(template),
      initializeTemplate,
    ),
  );
  const rootClone = astFactory.conditionalExpression(
    cloneEstreeNode(canReuse),
    astFactory.callExpression(
      astFactory.memberExpression(getTemplate, astFactory.identifier('cloneNode')),
      [astFactory.booleanLiteral(true)],
    ),
    getTemplate,
  );

  const referencedNodes = new Set<string>([rootVar]);
  for (const statement of retained) {
    walkNodes(statement, (node) => {
      if (astFactory.isIdentifier(node) && nodeNames.has(node.name)) {
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
        value = cloneEstreeNode(rootClone, true);
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
      return astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(name),
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
  documentVar: string,
): NodeFactory | null {
  if (statement.declarations.length !== 1) return null;
  const declaration = statement.declarations[0]!;
  if (
    !astFactory.isIdentifier(declaration.id) ||
    !astFactory.isCallExpression(declaration.init) ||
    !astFactory.isMemberExpression(declaration.init.callee) ||
    !astFactory.isIdentifier(declaration.init.callee.object, { name: documentVar }) ||
    !astFactory.isIdentifier(declaration.init.callee.property)
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
    astFactory.isStringLiteral(tag) &&
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
    !astFactory.isExpressionStatement(statement) ||
    !astFactory.isCallExpression(statement.expression) ||
    !astFactory.isMemberExpression(statement.expression.callee) ||
    !astFactory.isIdentifier(statement.expression.callee.object) ||
    !astFactory.isIdentifier(statement.expression.callee.property, {
      name: 'appendChild',
    }) ||
    statement.expression.arguments.length !== 1 ||
    !astFactory.isIdentifier(statement.expression.arguments[0])
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
  let current: t.Expression = astFactory.identifier(root);
  for (const index of path) {
    current = astFactory.memberExpression(current, astFactory.identifier('firstChild'));
    for (let sibling = 0; sibling < index; sibling++) {
      current = astFactory.memberExpression(current, astFactory.identifier('nextSibling'));
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
  if (!astFactory.isExpressionStatement(statement)) return false;
  const expression = statement.expression;

  if (
    astFactory.isCallExpression(expression) &&
    astFactory.isMemberExpression(expression.callee)
  ) {
    if (
      astFactory.isIdentifier(expression.callee.object) &&
      nodes.has(expression.callee.object.name) &&
      astFactory.isIdentifier(expression.callee.property, { name: 'setAttribute' }) &&
      expression.arguments.every(
        (argument) => astFactory.isExpression(argument) && isStaticValue(argument),
      )
    ) {
      return true;
    }
    if (
      astFactory.isIdentifier(expression.callee.object) &&
      astFactory.isIdentifier(expression.callee.property) &&
      STATIC_RUNTIME_SETTERS.has(expression.callee.property.name) &&
      expression.arguments.length >= 2 &&
      astFactory.isIdentifier(expression.arguments[0]) &&
      nodes.has(expression.arguments[0].name) &&
      expression.arguments
        .slice(1)
        .every(
          (argument) => astFactory.isExpression(argument) && isStaticValue(argument),
        )
    ) {
      return true;
    }
  }
  return false;
}

function isStaticValue(expression: t.Expression): boolean {
  if (
    astFactory.isStringLiteral(expression) ||
    astFactory.isNumericLiteral(expression) ||
    astFactory.isBooleanLiteral(expression) ||
    astFactory.isNullLiteral(expression)
  ) {
    return true;
  }
  if (astFactory.isArrayExpression(expression)) {
    return expression.elements.every(
      (element) => element === null || (astFactory.isExpression(element) && isStaticValue(element)),
    );
  }
  if (astFactory.isObjectExpression(expression)) {
    return expression.properties.every(
      (property) =>
        astFactory.isObjectProperty(property) &&
        !property.computed &&
        astFactory.isExpression(property.value) &&
        isStaticValue(property.value),
    );
  }
  return false;
}
