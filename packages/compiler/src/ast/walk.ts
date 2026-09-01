/**
 * Standard ESTree AST walker for @memoized-dom/compiler.
 *
 * Provides fast, zero-dependency, pure AST traversal over compiler-owned nodes.
 */

import type { BaseNode } from './types';

/** Standard ESTree visitor keys for all JavaScript and JSX node types. */
export const ESTREE_VISITOR_KEYS: Record<string, readonly string[]> = {
  Program: ['body'],
  Identifier: [],
  Literal: [],
  StringLiteral: [],
  NumericLiteral: [],
  BooleanLiteral: [],
  NullLiteral: [],
  ThisExpression: [],
  ArrayExpression: ['elements'],
  ObjectExpression: ['properties'],
  Property: ['key', 'value'],
  ObjectProperty: ['key', 'value'],
  SpreadElement: ['argument'],
  FunctionDeclaration: ['id', 'params', 'body'],
  FunctionExpression: ['id', 'params', 'body'],
  ArrowFunctionExpression: ['params', 'body'],
  VariableDeclaration: ['declarations'],
  VariableDeclarator: ['id', 'init'],
  BlockStatement: ['body'],
  ExpressionStatement: ['expression'],
  IfStatement: ['test', 'consequent', 'alternate'],
  ReturnStatement: ['argument'],
  MemberExpression: ['object', 'property'],
  OptionalMemberExpression: ['object', 'property'],
  CallExpression: ['callee', 'arguments'],
  OptionalCallExpression: ['callee', 'arguments'],
  UnaryExpression: ['argument'],
  UpdateExpression: ['argument'],
  BinaryExpression: ['left', 'right'],
  LogicalExpression: ['left', 'right'],
  AssignmentExpression: ['left', 'right'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  TemplateLiteral: ['quasis', 'expressions'],
  TemplateElement: [],
  TaggedTemplateExpression: ['tag', 'quasi'],
  NewExpression: ['callee', 'arguments'],
  SequenceExpression: ['expressions'],
  ParenthesizedExpression: ['expression'],
  YieldExpression: ['argument'],
  AwaitExpression: ['argument'],
  ChainExpression: ['expression'],
  ImportExpression: ['source'],
  MetaProperty: ['meta', 'property'],
  ClassDeclaration: ['id', 'superClass', 'body'],
  ClassExpression: ['id', 'superClass', 'body'],
  ClassBody: ['body'],
  MethodDefinition: ['key', 'value'],
  EmptyStatement: [],
  DebuggerStatement: [],
  WithStatement: ['object', 'body'],
  LabeledStatement: ['label', 'body'],
  BreakStatement: ['label'],
  ContinueStatement: ['label'],
  SwitchStatement: ['discriminant', 'cases'],
  SwitchCase: ['test', 'consequent'],
  ThrowStatement: ['argument'],
  TryStatement: ['block', 'handler', 'finalizer'],
  CatchClause: ['param', 'body'],
  WhileStatement: ['test', 'body'],
  DoWhileStatement: ['body', 'test'],
  ForStatement: ['init', 'test', 'update', 'body'],
  ForInStatement: ['left', 'right', 'body'],
  ForOfStatement: ['left', 'right', 'body'],
  ImportDeclaration: ['specifiers', 'source'],
  ImportSpecifier: ['imported', 'local'],
  ImportDefaultSpecifier: ['local'],
  ImportNamespaceSpecifier: ['local'],
  ExportNamedDeclaration: ['declaration', 'specifiers', 'source'],
  ExportSpecifier: ['local', 'exported'],
  ExportDefaultDeclaration: ['declaration'],
  ExportAllDeclaration: ['source', 'exported'],
  RestElement: ['argument'],
  AssignmentPattern: ['left', 'right'],
  ArrayPattern: ['elements'],
  ObjectPattern: ['properties'],

  // JSX Visitor Keys
  JSXElement: ['openingElement', 'children', 'closingElement'],
  JSXOpeningElement: ['name', 'attributes'],
  JSXClosingElement: ['name'],
  JSXIdentifier: [],
  JSXMemberExpression: ['object', 'property'],
  JSXNamespacedName: ['namespace', 'name'],
  JSXAttribute: ['name', 'value'],
  JSXSpreadAttribute: ['argument'],
  JSXExpressionContainer: ['expression'],
  JSXEmptyExpression: [],
  JSXText: [],
  JSXFragment: ['openingFragment', 'children', 'closingFragment'],
  JSXOpeningFragment: [],
  JSXClosingFragment: [],
  JSXSpreadChild: ['expression'],

  // TypeScript AST Visitor Keys (for transparent type-stripping / passthrough)
  TSTypeAnnotation: ['typeAnnotation'],
  TSTypeAliasDeclaration: ['id', 'typeAnnotation'],
  TSInterfaceDeclaration: ['id', 'body'],
  TSTypeParameterDeclaration: ['params'],
  TSTypeParameterInstantiation: ['params'],
  TSAsExpression: ['expression', 'typeAnnotation'],
  TSTypeAssertion: ['expression', 'typeAnnotation'],
  TSNonNullExpression: ['expression'],
};

export interface ASTVisitor<TNode extends BaseNode = BaseNode> {
  enter?: (
    node: TNode,
    parent: TNode | null,
    key?: string,
    index?: number,
  ) => boolean | void;
  leave?: (
    node: TNode,
    parent: TNode | null,
    key?: string,
    index?: number,
  ) => void;
}

/**
 * Recursively walk an AST node using standard visitor keys.
 * Returning `false` from `enter` skips the node's children.
 */
export function walkAst<TNode extends BaseNode = BaseNode>(
  root: TNode,
  visitor: ASTVisitor<TNode>,
): void {
  function visit(
    node: TNode,
    parent: TNode | null,
    key?: string,
    index?: number,
  ): void {
    if (visitor.enter) {
      const result = visitor.enter(node, parent, key, index);
      if (result === false) return;
    }

    const keys = ESTREE_VISITOR_KEYS[node.type] ?? Object.keys(node);
    for (const childKey of keys) {
      const child = (node as Record<string, unknown>)[childKey];
      if (Array.isArray(child)) {
        const items: readonly unknown[] = child;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item && typeof item === 'object' && 'type' in item) {
            visit(item as TNode, node, childKey, i);
          }
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        visit(child as TNode, node, childKey, undefined);
      }
    }

    if (visitor.leave) {
      visitor.leave(node, parent, key, index);
    }
  }

  visit(root, null, undefined, undefined);
}

/** Collect all AST nodes satisfying a predicate. */
export function collectNodes<T extends BaseNode = BaseNode>(
  root: BaseNode,
  predicate: (node: BaseNode) => node is T,
): T[] {
  const result: T[] = [];
  walkAst(root, {
    enter(node) {
      if (predicate(node)) {
        result.push(node);
      }
    },
  });
  return result;
}

/** Find the first AST node satisfying a predicate. */
export function findNode<T extends BaseNode = BaseNode>(
  root: BaseNode,
  predicate: (node: BaseNode) => node is T,
): T | null {
  let found: T | null = null;
  walkAst(root, {
    enter(node) {
      if (found !== null) return false;
      if (predicate(node)) {
        found = node;
        return false;
      }
    },
  });
  return found;
}
