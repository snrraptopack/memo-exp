/**
 * Pure ESTree AST builders and predicates for @memoized-dom/compiler.
 *
 * All functions return plain JavaScript objects in the ESTree node dialect.
 * ZERO dependencies on Babel or proprietary AST formats.
 */

import type {
  ArrayExpression,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentPattern,
  BaseNode,
  BinaryExpression,
  BlockStatement,
  BooleanLiteral,
  CallExpression,
  ConditionalExpression,
  Declaration,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ExportSpecifier,
  Expression,
  ExpressionStatement,
  ForOfStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  ImportDeclaration,
  ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  JSXAttribute,
  JSXChild,
  JSXClosingElement,
  JSXClosingFragment,
  JSXElement,
  JSXEmptyExpression,
  JSXExpressionContainer,
  JSXFragment,
  JSXIdentifier,
  JSXMemberExpression,
  JSXNamespacedName,
  JSXOpeningElement,
  JSXOpeningFragment,
  JSXSpreadAttribute,
  JSXTagName,
  JSXText,
  Literal,
  LogicalExpression,
  MemberExpression,
  NewExpression,
  NullLiteral,
  NumericLiteral,
  ObjectExpression,
  Pattern,
  Program,
  Property,
  ReturnStatement,
  SequenceExpression,
  SpreadElement,
  Statement,
  StringLiteral,
  TemplateElement,
  TemplateLiteral,
  UnaryExpression,
  VariableDeclaration,
  VariableDeclarator,
} from './types';

// -- Literals & Identifiers ---------------------------------------------------

export function identifier(name: string): Identifier {
  return {
    type: 'Identifier',
    name,
  };
}

export function literal(
  value: string | number | boolean | null | RegExp | bigint,
  raw?: string,
): Literal {
  return {
    type: 'Literal',
    value,
    raw: raw ?? (typeof value === 'string' ? JSON.stringify(value) : String(value)),
  };
}

export function stringLiteral(value: string): StringLiteral {
  return {
    type: 'Literal',
    value,
    raw: JSON.stringify(value),
  };
}

export function numericLiteral(value: number): NumericLiteral {
  return {
    type: 'Literal',
    value,
    raw: String(value),
  };
}

export function booleanLiteral(value: boolean): BooleanLiteral {
  return {
    type: 'Literal',
    value,
    raw: String(value),
  };
}

export function nullLiteral(): NullLiteral {
  return {
    type: 'Literal',
    value: null,
    raw: 'null',
  };
}

// -- Expressions --------------------------------------------------------------

export function callExpression(
  callee: Expression,
  arguments_: Array<Expression | SpreadElement>,
): CallExpression {
  return {
    type: 'CallExpression',
    callee,
    arguments: arguments_,
  };
}

export function optionalCallExpression(
  callee: Expression,
  arguments_: Array<Expression | SpreadElement>,
): CallExpression {
  return {
    type: 'CallExpression',
    callee,
    arguments: arguments_,
    optional: true,
  };
}

export function memberExpression(
  object: Expression,
  property: Expression,
  computed = false,
  optional = false,
): MemberExpression {
  return {
    type: 'MemberExpression',
    object,
    property,
    computed,
    optional: optional ? true : undefined,
  };
}

export function optionalMemberExpression(
  object: Expression,
  property: Expression,
  computed = false,
): MemberExpression {
  return memberExpression(object, property, computed, true);
}

export function arrayExpression(
  elements: Array<Expression | SpreadElement | null> = [],
): ArrayExpression {
  return {
    type: 'ArrayExpression',
    elements,
  };
}

export function objectExpression(
  properties: Array<Property | SpreadElement> = [],
): ObjectExpression {
  return {
    type: 'ObjectExpression',
    properties,
  };
}

export function property(
  kind: 'init' | 'get' | 'set',
  key: Expression,
  value: Expression | Pattern,
  computed = false,
  shorthand = false,
): Property {
  return {
    type: 'Property',
    key,
    value,
    kind,
    method: false,
    shorthand,
    computed,
  };
}

export function objectProperty(
  key: Expression,
  value: Expression | Pattern,
  computed = false,
  shorthand = false,
): Property {
  return {
    type: 'Property',
    key,
    value,
    kind: 'init',
    method: false,
    shorthand,
    computed,
  };
}

export function spreadElement(argument: Expression): SpreadElement {
  return {
    type: 'SpreadElement',
    argument,
  };
}

export function newExpression(
  callee: Expression,
  arguments_: Array<Expression | SpreadElement> = [],
): NewExpression {
  return {
    type: 'NewExpression',
    callee,
    arguments: arguments_,
  };
}

export function binaryExpression(
  operator: BinaryExpression['operator'],
  left: Expression,
  right: Expression,
): BinaryExpression {
  return {
    type: 'BinaryExpression',
    operator,
    left,
    right,
  };
}

export function unaryExpression(
  operator: UnaryExpression['operator'],
  argument: Expression,
  prefix = true,
): UnaryExpression {
  return {
    type: 'UnaryExpression',
    operator,
    argument,
    prefix,
  };
}

export function logicalExpression(
  operator: LogicalExpression['operator'],
  left: Expression,
  right: Expression,
): LogicalExpression {
  return {
    type: 'LogicalExpression',
    operator,
    left,
    right,
  };
}

export function assignmentExpression(
  operator: string,
  left: Pattern | MemberExpression,
  right: Expression,
): AssignmentExpression {
  return {
    type: 'AssignmentExpression',
    operator,
    left,
    right,
  };
}

export function conditionalExpression(
  test: Expression,
  consequent: Expression,
  alternate: Expression,
): ConditionalExpression {
  return {
    type: 'ConditionalExpression',
    test,
    consequent,
    alternate,
  };
}

export function sequenceExpression(expressions: Expression[]): SequenceExpression {
  return {
    type: 'SequenceExpression',
    expressions,
  };
}

export function templateElement(
  value: { raw: string; cooked?: string | null },
  tail = false,
): TemplateElement {
  return {
    type: 'TemplateElement',
    value: {
      raw: value.raw,
      cooked: value.cooked ?? value.raw,
    },
    tail,
  };
}

export function templateLiteral(
  quasis: TemplateElement[],
  expressions: Expression[],
): TemplateLiteral {
  return {
    type: 'TemplateLiteral',
    quasis,
    expressions,
  };
}

export function assignmentPattern(
  left: Pattern,
  right: Expression,
): AssignmentPattern {
  return {
    type: 'AssignmentPattern',
    left,
    right,
  };
}

export function valueToNode(value: unknown): Expression {
  if (value === null) return nullLiteral();
  if (typeof value === 'boolean') return booleanLiteral(value);
  if (typeof value === 'number') return numericLiteral(value);
  if (typeof value === 'string') return stringLiteral(value);
  if (Array.isArray(value)) {
    return arrayExpression(value.map((v) => valueToNode(v)));
  }
  if (typeof value === 'object') {
    const props = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      objectProperty(identifier(k), valueToNode(v)),
    );
    return objectExpression(props);
  }
  return identifier('undefined');
}

// -- Functions & Statements ---------------------------------------------------

export function functionDeclaration(
  id: Identifier | null,
  params: Pattern[],
  body: BlockStatement,
  generator = false,
  async = false,
): FunctionDeclaration {
  return {
    type: 'FunctionDeclaration',
    id,
    params,
    body,
    generator,
    async,
  };
}

export function functionExpression(
  id: Identifier | null,
  params: Pattern[],
  body: BlockStatement,
  generator = false,
  async = false,
): FunctionExpression {
  return {
    type: 'FunctionExpression',
    id,
    params,
    body,
    generator,
    async,
  };
}

export function arrowFunctionExpression(
  params: Pattern[],
  body: BlockStatement | Expression,
  async = false,
): ArrowFunctionExpression {
  const isExpression = body.type !== 'BlockStatement';
  return {
    type: 'ArrowFunctionExpression',
    params,
    body,
    generator: false,
    async,
    expression: isExpression,
  };
}

export function blockStatement(body: Statement[] = []): BlockStatement {
  return {
    type: 'BlockStatement',
    body,
  };
}

export function expressionStatement(expression: Expression): ExpressionStatement {
  return {
    type: 'ExpressionStatement',
    expression,
  };
}

export function returnStatement(argument: Expression | null = null): ReturnStatement {
  return {
    type: 'ReturnStatement',
    argument,
  };
}

export function ifStatement(
  test: Expression,
  consequent: Statement,
  alternate: Statement | null = null,
): IfStatement {
  return {
    type: 'IfStatement',
    test,
    consequent,
    alternate,
  };
}

export function forOfStatement(
  left: VariableDeclaration | Pattern,
  right: Expression,
  body: Statement,
  isAwait = false,
): ForOfStatement {
  return {
    type: 'ForOfStatement',
    left,
    right,
    body,
    await: isAwait,
  };
}

export function variableDeclaration(
  kind: 'var' | 'let' | 'const',
  declarations: VariableDeclarator[],
): VariableDeclaration {
  return {
    type: 'VariableDeclaration',
    kind,
    declarations,
  };
}

export function variableDeclarator(
  id: Pattern,
  init: Expression | null = null,
): VariableDeclarator {
  return {
    type: 'VariableDeclarator',
    id,
    init,
  };
}

export function program(
  body: Statement[] = [],
  sourceType: 'script' | 'module' = 'module',
): Program {
  return {
    type: 'Program',
    body,
    sourceType,
  };
}

// -- Module Declarations ------------------------------------------------------

export function importDeclaration(
  specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>,
  source: Literal,
): ImportDeclaration {
  return {
    type: 'ImportDeclaration',
    specifiers,
    source,
  };
}

export function importSpecifier(
  local: Identifier,
  imported: Identifier = local,
): ImportSpecifier {
  return {
    type: 'ImportSpecifier',
    local,
    imported,
  };
}

export function importDefaultSpecifier(local: Identifier): ImportDefaultSpecifier {
  return {
    type: 'ImportDefaultSpecifier',
    local,
  };
}

export function importNamespaceSpecifier(local: Identifier): ImportNamespaceSpecifier {
  return {
    type: 'ImportNamespaceSpecifier',
    local,
  };
}

export function exportNamedDeclaration(
  declaration: Declaration | null = null,
  specifiers: ExportSpecifier[] = [],
  source: Literal | null = null,
): ExportNamedDeclaration {
  return {
    type: 'ExportNamedDeclaration',
    declaration,
    specifiers,
    source,
  };
}

export function exportSpecifier(
  local: Identifier,
  exported: Identifier = local,
): ExportSpecifier {
  return {
    type: 'ExportSpecifier',
    local,
    exported,
  };
}

export function exportDefaultDeclaration(
  declaration: Declaration | Expression,
): ExportDefaultDeclaration {
  return {
    type: 'ExportDefaultDeclaration',
    declaration,
  };
}

export function exportAllDeclaration(
  source: Literal,
  exported: Identifier | null = null,
): ExportAllDeclaration {
  return {
    type: 'ExportAllDeclaration',
    source,
    exported,
  };
}

// -- JSX Nodes ----------------------------------------------------------------

export function jsxIdentifier(name: string): JSXIdentifier {
  return {
    type: 'JSXIdentifier',
    name,
  };
}

export function jsxMemberExpression(
  object: JSXMemberExpression | JSXIdentifier,
  property: JSXIdentifier,
): JSXMemberExpression {
  return {
    type: 'JSXMemberExpression',
    object,
    property,
  };
}

export function jsxAttribute(
  name: JSXIdentifier | JSXNamespacedName,
  value: Literal | JSXExpressionContainer | JSXElement | JSXFragment | null = null,
): JSXAttribute {
  return {
    type: 'JSXAttribute',
    name,
    value,
  };
}

export function jsxSpreadAttribute(argument: Expression): JSXSpreadAttribute {
  return {
    type: 'JSXSpreadAttribute',
    argument,
  };
}

export function jsxExpressionContainer(
  expression: Expression | JSXEmptyExpression,
): JSXExpressionContainer {
  return {
    type: 'JSXExpressionContainer',
    expression,
  };
}

export function jsxText(value: string, raw?: string): JSXText {
  return {
    type: 'JSXText',
    value,
    raw: raw ?? value,
  };
}

export function jsxOpeningElement(
  name: JSXTagName,
  attributes: Array<JSXAttribute | JSXSpreadAttribute> = [],
  selfClosing = false,
): JSXOpeningElement {
  return {
    type: 'JSXOpeningElement',
    name,
    attributes,
    selfClosing,
  };
}

export function jsxClosingElement(name: JSXTagName): JSXClosingElement {
  return {
    type: 'JSXClosingElement',
    name,
  };
}

export function jsxElement(
  openingElement: JSXOpeningElement,
  closingElement: JSXClosingElement | null,
  children: JSXChild[] = [],
): JSXElement {
  return {
    type: 'JSXElement',
    openingElement,
    closingElement,
    children,
  };
}

export function jsxOpeningFragment(): JSXOpeningFragment {
  return {
    type: 'JSXOpeningFragment',
  };
}

export function jsxClosingFragment(): JSXClosingFragment {
  return {
    type: 'JSXClosingFragment',
  };
}

export function jsxFragment(
  openingFragment: JSXOpeningFragment = jsxOpeningFragment(),
  closingFragment: JSXClosingFragment = jsxClosingFragment(),
  children: JSXChild[] = [],
): JSXFragment {
  return {
    type: 'JSXFragment',
    openingFragment,
    closingFragment,
    children,
  };
}

// -- Clone & Utility ----------------------------------------------------------

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(cloneValue);
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      copy[key] = cloneValue(child);
    }
    return copy;
  }
  return value;
}

export function cloneNode<T extends BaseNode>(node: T): T {
  return cloneValue(node) as T;
}

// -- Type Predicates ----------------------------------------------------------

export function isIdentifier(node: unknown): node is Identifier {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'Identifier');
}

export function isLiteral(node: unknown): node is Literal {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'Literal');
}

export function isStringLiteral(node: unknown): node is StringLiteral {
  return Boolean(
    node &&
      typeof node === 'object' &&
      (node as BaseNode).type === 'Literal' &&
      typeof (node as Literal).value === 'string',
  );
}

export function isNumericLiteral(node: unknown): node is NumericLiteral {
  return Boolean(
    node &&
      typeof node === 'object' &&
      (node as BaseNode).type === 'Literal' &&
      typeof (node as Literal).value === 'number',
  );
}

export function isBooleanLiteral(node: unknown): node is BooleanLiteral {
  return Boolean(
    node &&
      typeof node === 'object' &&
      (node as BaseNode).type === 'Literal' &&
      typeof (node as Literal).value === 'boolean',
  );
}

export function isNullLiteral(node: unknown): node is NullLiteral {
  return Boolean(
    node &&
      typeof node === 'object' &&
      (node as BaseNode).type === 'Literal' &&
      (node as Literal).value === null,
  );
}

export function isCallExpression(node: unknown): node is CallExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'CallExpression');
}

export function isMemberExpression(node: unknown): node is MemberExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'MemberExpression');
}

export function isArrayExpression(node: unknown): node is ArrayExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'ArrayExpression');
}

export function isObjectExpression(node: unknown): node is ObjectExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'ObjectExpression');
}

export function isProperty(node: unknown): node is Property {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'Property');
}

export function isObjectProperty(node: unknown): node is Property {
  return isProperty(node);
}

export function isFunctionDeclaration(node: unknown): node is FunctionDeclaration {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'FunctionDeclaration');
}

export function isArrowFunctionExpression(node: unknown): node is ArrowFunctionExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'ArrowFunctionExpression');
}

export function isVariableDeclaration(node: unknown): node is VariableDeclaration {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'VariableDeclaration');
}

export function isVariableDeclarator(node: unknown): node is VariableDeclarator {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'VariableDeclarator');
}

export function isBlockStatement(node: unknown): node is BlockStatement {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'BlockStatement');
}

export function isReturnStatement(node: unknown): node is ReturnStatement {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'ReturnStatement');
}

export function isIfStatement(node: unknown): node is IfStatement {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'IfStatement');
}

export function isExpressionStatement(node: unknown): node is ExpressionStatement {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'ExpressionStatement');
}

export function isAssignmentExpression(node: unknown): node is AssignmentExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'AssignmentExpression');
}

export function isBinaryExpression(node: unknown): node is BinaryExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'BinaryExpression');
}

export function isUnaryExpression(node: unknown): node is UnaryExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'UnaryExpression');
}

export function isLogicalExpression(node: unknown): node is LogicalExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'LogicalExpression');
}

export function isConditionalExpression(node: unknown): node is ConditionalExpression {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'ConditionalExpression');
}

export function isExpression(node: unknown): node is Expression {
  if (!node || typeof node !== 'object') return false;
  const type = (node as BaseNode).type;
  return (
    isIdentifier(node) ||
    isLiteral(node) ||
    isCallExpression(node) ||
    isMemberExpression(node) ||
    isArrayExpression(node) ||
    isObjectExpression(node) ||
    isArrowFunctionExpression(node) ||
    isUnaryExpression(node) ||
    isBinaryExpression(node) ||
    isLogicalExpression(node) ||
    isAssignmentExpression(node) ||
    isConditionalExpression(node) ||
    isJSXElement(node) ||
    isJSXFragment(node) ||
    type === 'ThisExpression' ||
    type === 'FunctionExpression' ||
    type === 'TemplateLiteral' ||
    type === 'TaggedTemplateExpression' ||
    type === 'SequenceExpression' ||
    type === 'AwaitExpression' ||
    type === 'ChainExpression'
  );
}

export function isStatement(node: unknown): node is Statement {
  if (!node || typeof node !== 'object') return false;
  const type = (node as BaseNode).type;
  return (
    isExpressionStatement(node) ||
    isBlockStatement(node) ||
    isReturnStatement(node) ||
    isIfStatement(node) ||
    isVariableDeclaration(node) ||
    isFunctionDeclaration(node) ||
    type === 'EmptyStatement' ||
    type === 'DebuggerStatement' ||
    type === 'WithStatement' ||
    type === 'LabeledStatement' ||
    type === 'BreakStatement' ||
    type === 'ContinueStatement' ||
    type === 'SwitchStatement' ||
    type === 'ThrowStatement' ||
    type === 'TryStatement' ||
    type === 'WhileStatement' ||
    type === 'DoWhileStatement' ||
    type === 'ForStatement' ||
    type === 'ForInStatement' ||
    type === 'ForOfStatement' ||
    type === 'ClassDeclaration' ||
    type === 'ImportDeclaration' ||
    type === 'ExportNamedDeclaration' ||
    type === 'ExportDefaultDeclaration' ||
    type === 'ExportAllDeclaration'
  );
}

export function isJSXElement(node: unknown): node is JSXElement {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXElement');
}

export function isJSXAttribute(node: unknown): node is JSXAttribute {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXAttribute');
}

export function isJSXExpressionContainer(node: unknown): node is JSXExpressionContainer {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXExpressionContainer');
}

export function isJSXText(node: unknown): node is JSXText {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXText');
}

export function isJSXFragment(node: unknown): node is JSXFragment {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXFragment');
}
export function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

export function isJSXSpreadAttribute(node: unknown): node is JSXSpreadAttribute {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXSpreadAttribute');
}

export function isJSXIdentifier(node: unknown): node is JSXIdentifier {
  return Boolean(node && typeof node === 'object' && (node as BaseNode).type === 'JSXIdentifier');
}
