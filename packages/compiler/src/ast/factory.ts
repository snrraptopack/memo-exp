/**
 * ESTree node construction and predicates exposed through compiler-owned node
 * contracts. Every function in this module constructs plain ESTree nodes.
 */

import type * as t from './compiler-types';
import * as estree from './builders';

export const identifier = estree.identifier;
export const stringLiteral = estree.stringLiteral;
export const numericLiteral = estree.numericLiteral;
export const booleanLiteral = estree.booleanLiteral;
export const nullLiteral = estree.nullLiteral;
export const callExpression = estree.callExpression;
export const memberExpression = estree.memberExpression;
export const optionalMemberExpression =
  estree.optionalMemberExpression;
export const arrayExpression = estree.arrayExpression;
export const objectExpression = estree.objectExpression;
export const objectProperty = estree.objectProperty;
export const spreadElement = estree.spreadElement;
export const newExpression = estree.newExpression;
export const binaryExpression = estree.binaryExpression;
export const unaryExpression = estree.unaryExpression;
export const logicalExpression = estree.logicalExpression;
export const assignmentExpression =
  estree.assignmentExpression;
export const conditionalExpression =
  estree.conditionalExpression;
export const sequenceExpression =
  estree.sequenceExpression;
export const assignmentPattern =
  estree.assignmentPattern;
export const functionDeclaration =
  estree.functionDeclaration;
export const arrowFunctionExpression =
  estree.arrowFunctionExpression;
export const blockStatement = estree.blockStatement;
export const expressionStatement =
  estree.expressionStatement;
export const returnStatement = estree.returnStatement;
export const ifStatement = estree.ifStatement;
export const forOfStatement = estree.forOfStatement;
export const variableDeclaration =
  estree.variableDeclaration;
export const variableDeclarator =
  estree.variableDeclarator;
export const importDeclaration =
  estree.importDeclaration;
export const importSpecifier = estree.importSpecifier;
export const importDefaultSpecifier =
  estree.importDefaultSpecifier;
export const importNamespaceSpecifier =
  estree.importNamespaceSpecifier;
export const exportNamedDeclaration =
  estree.exportNamedDeclaration;
export const jsxIdentifier = estree.jsxIdentifier;
export const jsxAttribute = estree.jsxAttribute;
export const jsxExpressionContainer =
  estree.jsxExpressionContainer;
export const jsxOpeningElement =
  estree.jsxOpeningElement;
export const jsxElement = estree.jsxElement;
export const jsxOpeningFragment =
  estree.jsxOpeningFragment;
export const jsxClosingFragment =
  estree.jsxClosingFragment;
export const jsxFragment = estree.jsxFragment;

export const updateExpression = (
  operator: t.UpdateExpression['operator'],
  argument: t.UpdateExpression['argument'],
  prefix = false,
): t.UpdateExpression => ({ type: 'UpdateExpression', operator, argument, prefix });

export const switchCase = (
  test: t.SwitchCase['test'],
  consequent: t.SwitchCase['consequent'],
): t.SwitchCase => ({ type: 'SwitchCase', test, consequent });

export const switchStatement = (
  discriminant: t.SwitchStatement['discriminant'],
  cases: t.SwitchCase[],
): t.SwitchStatement => ({ type: 'SwitchStatement', discriminant, cases });

export const metaProperty = (meta: t.Identifier, property: t.Identifier): t.MetaProperty => ({
  type: 'MetaProperty',
  meta,
  property,
});

export const tsTypeLiteral = (members: t.TSTypeElement[] = []): t.TSTypeLiteral => ({
  type: 'TSTypeLiteral',
  members,
});

function nodeType(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const type = (node as Record<string, unknown>).type;
  return typeof type === 'string' ? type : null;
}

function matchesOptions(node: unknown, options: object | null | undefined): boolean {
  if (options == null) return true;
  if (!node || typeof node !== 'object') return false;
  const fields = node as Record<string, unknown>;
  return Object.entries(options).every(([key, value]) => fields[key] === value);
}

function predicate<T extends t.Node>(
  check: (node: unknown) => boolean,
): (node: unknown, options?: object | null) => node is T {
  return function isMatchingNode(
    node: unknown,
    options?: object | null,
  ): node is T {
    return check(node) && matchesOptions(node, options);
  };
}

function hasType(...types: string[]): (node: unknown) => boolean {
  const accepted = new Set(types);
  return (node) => {
    const type = nodeType(node);
    return type !== null && accepted.has(type);
  };
}

const isString = (node: unknown): boolean =>
  nodeType(node) === 'StringLiteral' || estree.isStringLiteral(node);
const isNumber = (node: unknown): boolean =>
  nodeType(node) === 'NumericLiteral' || estree.isNumericLiteral(node);
const isBoolean = (node: unknown): boolean =>
  nodeType(node) === 'BooleanLiteral' || estree.isBooleanLiteral(node);
const isNull = (node: unknown): boolean =>
  nodeType(node) === 'NullLiteral' || estree.isNullLiteral(node);
const isObjectPropertyNode = hasType('Property', 'ObjectProperty');

export const isNode = predicate<t.Node>((node) => nodeType(node) !== null);
export const isIdentifier = predicate<t.Identifier>(estree.isIdentifier);
export const isStringLiteral = predicate<t.StringLiteral>(isString);
export const isNumericLiteral = predicate<t.NumericLiteral>(isNumber);
export const isBooleanLiteral = predicate<t.BooleanLiteral>(isBoolean);
export const isNullLiteral = predicate<t.NullLiteral>(isNull);
export const isBigIntLiteral = predicate<t.BigIntLiteral>(hasType('BigIntLiteral'));
export const isCallExpression = predicate<t.CallExpression>(
  hasType('CallExpression'),
);
export const isOptionalCallExpression = predicate<t.OptionalCallExpression>((node) =>
  nodeType(node) === 'OptionalCallExpression' ||
  (nodeType(node) === 'CallExpression' &&
    (node as Record<string, unknown>).optional === true),
);
export const isMemberExpression = predicate<t.MemberExpression>(
  hasType('MemberExpression'),
);
export const isOptionalMemberExpression = predicate<t.OptionalMemberExpression>(
  (node) =>
    nodeType(node) === 'OptionalMemberExpression' ||
    (nodeType(node) === 'MemberExpression' &&
      (node as Record<string, unknown>).optional === true),
);
export const isArrayExpression = predicate<t.ArrayExpression>(estree.isArrayExpression);
export const isObjectExpression = predicate<t.ObjectExpression>(
  estree.isObjectExpression,
);
export const isObjectProperty = predicate<t.ObjectProperty>(isObjectPropertyNode);
export const isFunctionDeclaration = predicate<t.FunctionDeclaration>(
  estree.isFunctionDeclaration,
);
export const isFunctionExpression = predicate<t.FunctionExpression>(
  hasType('FunctionExpression'),
);
export const isArrowFunctionExpression = predicate<t.ArrowFunctionExpression>(
  estree.isArrowFunctionExpression,
);
export const isFunction = predicate<t.Function>(
  hasType(
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
  ),
);
export const isVariableDeclaration = predicate<t.VariableDeclaration>(
  estree.isVariableDeclaration,
);
export const isVariableDeclarator = predicate<t.VariableDeclarator>(
  estree.isVariableDeclarator,
);
export const isBlockStatement = predicate<t.BlockStatement>(estree.isBlockStatement);
export const isReturnStatement = predicate<t.ReturnStatement>(estree.isReturnStatement);
export const isIfStatement = predicate<t.IfStatement>(estree.isIfStatement);
export const isExpressionStatement = predicate<t.ExpressionStatement>(
  estree.isExpressionStatement,
);
export const isAssignmentExpression = predicate<t.AssignmentExpression>(
  estree.isAssignmentExpression,
);
export const isUpdateExpression = predicate<t.UpdateExpression>(
  hasType('UpdateExpression'),
);
export const isUnaryExpression = predicate<t.UnaryExpression>(estree.isUnaryExpression);
export const isLogicalExpression = predicate<t.LogicalExpression>(
  estree.isLogicalExpression,
);
export const isConditionalExpression = predicate<t.ConditionalExpression>(
  estree.isConditionalExpression,
);
export const isExpression = predicate<t.Expression>((node) => {
  const type = nodeType(node);
  return (
    estree.isExpression(node) ||
    type === 'StringLiteral' ||
    type === 'NumericLiteral' ||
    type === 'BooleanLiteral' ||
    type === 'NullLiteral' ||
    type === 'BigIntLiteral' ||
    type === 'RegExpLiteral' ||
    type === 'OptionalMemberExpression' ||
    type === 'OptionalCallExpression' ||
    type === 'MetaProperty' ||
    type === 'Super' ||
    type === 'UpdateExpression' ||
    type === 'YieldExpression' ||
    type === 'NewExpression' ||
    type === 'ClassExpression' ||
    type === 'TSAsExpression' ||
    type === 'TSTypeAssertion' ||
    type === 'TSNonNullExpression' ||
    type === 'TSSatisfiesExpression' ||
    type === 'TSInstantiationExpression' ||
    type === 'TypeCastExpression'
  );
});
export const isJSXElement = predicate<t.JSXElement>(estree.isJSXElement);
export const isJSXFragment = predicate<t.JSXFragment>(estree.isJSXFragment);
export const isJSXAttribute = predicate<t.JSXAttribute>(estree.isJSXAttribute);
export const isJSXSpreadAttribute = predicate<t.JSXSpreadAttribute>(
  estree.isJSXSpreadAttribute,
);
export const isJSXExpressionContainer = predicate<t.JSXExpressionContainer>(
  estree.isJSXExpressionContainer,
);
export const isJSXIdentifier = predicate<t.JSXIdentifier>(estree.isJSXIdentifier);
export const isJSXText = predicate<t.JSXText>(estree.isJSXText);
export const isJSXEmptyExpression = predicate<t.JSXEmptyExpression>(
  hasType('JSXEmptyExpression'),
);
export const isJSXNamespacedName = predicate<t.JSXNamespacedName>(
  hasType('JSXNamespacedName'),
);
export const isObjectPattern = predicate<t.ObjectPattern>(hasType('ObjectPattern'));
export const isArrayPattern = predicate<t.ArrayPattern>(hasType('ArrayPattern'));
export const isAssignmentPattern = predicate<t.AssignmentPattern>(
  hasType('AssignmentPattern'),
);
export const isRestElement = predicate<t.RestElement>(hasType('RestElement'));
export const isSpreadElement = predicate<t.SpreadElement>(hasType('SpreadElement'));
export const isExportNamedDeclaration = predicate<t.ExportNamedDeclaration>(
  hasType('ExportNamedDeclaration'),
);
export const isExportDefaultDeclaration = predicate<t.ExportDefaultDeclaration>(
  hasType('ExportDefaultDeclaration'),
);
export const isExportSpecifier = predicate<t.ExportSpecifier>(
  hasType('ExportSpecifier'),
);
export const isImportDeclaration = predicate<t.ImportDeclaration>(
  hasType('ImportDeclaration'),
);
export const isImportSpecifier = predicate<t.ImportSpecifier>(hasType('ImportSpecifier'));
export const isImportDefaultSpecifier = predicate<t.ImportDefaultSpecifier>(
  hasType('ImportDefaultSpecifier'),
);
export const isSwitchStatement = predicate<t.SwitchStatement>(
  hasType('SwitchStatement'),
);
export const isBreakStatement = predicate<t.BreakStatement>(hasType('BreakStatement'));
export const isEmptyStatement = predicate<t.EmptyStatement>(hasType('EmptyStatement'));
export const isAwaitExpression = predicate<t.AwaitExpression>(hasType('AwaitExpression'));
export const isYieldExpression = predicate<t.YieldExpression>(hasType('YieldExpression'));
export const isNewExpression = predicate<t.NewExpression>(hasType('NewExpression'));
export const isTemplateLiteral = predicate<t.TemplateLiteral>(hasType('TemplateLiteral'));
export const isSuper = predicate<t.Super>(hasType('Super'));
export const isPrivateName = predicate<t.PrivateName>(hasType('PrivateName'));
export const isClassDeclaration = predicate<t.ClassDeclaration>(
  hasType('ClassDeclaration'),
);
export const isTypeCastExpression = predicate<t.TypeCastExpression>(
  hasType('TypeCastExpression'),
);
export const isTransparentExpression = predicate<t.TransparentExpression>(
  hasType(
    'TSAsExpression',
    'TSTypeAssertion',
    'TSNonNullExpression',
    'TSSatisfiesExpression',
    'TSInstantiationExpression',
    'TypeCastExpression',
  ),
);
export const isTypeScript = predicate<t.TypeScriptNode>((node) =>
  nodeType(node)?.startsWith('TS') === true,
);

export const isTSAsExpression = predicate<t.TSAsExpression>(hasType('TSAsExpression'));
export const isTSTypeAssertion = predicate<t.TSTypeAssertion>(
  hasType('TSTypeAssertion'),
);
export const isTSNonNullExpression = predicate<t.TSNonNullExpression>(
  hasType('TSNonNullExpression'),
);
export const isTSSatisfiesExpression = predicate<t.TSSatisfiesExpression>(
  hasType('TSSatisfiesExpression'),
);
export const isTSInstantiationExpression = predicate<t.TSInstantiationExpression>(
  hasType('TSInstantiationExpression'),
);
export const isTSTypeAliasDeclaration = predicate<t.TSTypeAliasDeclaration>(
  hasType('TSTypeAliasDeclaration'),
);
export const isTSInterfaceDeclaration = predicate<t.TSInterfaceDeclaration>(
  hasType('TSInterfaceDeclaration'),
);
export const isTSParameterProperty = predicate<t.TSParameterProperty>(
  hasType('TSParameterProperty'),
);
export const isTSTypeAnnotation = predicate<t.TSTypeAnnotation>(
  hasType('TSTypeAnnotation'),
);
export const isTSTypeReference = predicate<t.TSTypeReference>(
  hasType('TSTypeReference'),
);
export const isTSTypeLiteral = predicate<t.TSTypeLiteral>(hasType('TSTypeLiteral'));
export const isTSPropertySignature = predicate<t.TSPropertySignature>(
  hasType('TSPropertySignature'),
);
export const isTSUndefinedKeyword = predicate<t.TSUndefinedKeyword>(
  hasType('TSUndefinedKeyword'),
);
export const isTSNullKeyword = predicate<t.TSNullKeyword>(hasType('TSNullKeyword'));
export const isTSSymbolKeyword = predicate<t.TSSymbolKeyword>(hasType('TSSymbolKeyword'));
export const isTSUnionType = predicate<t.TSUnionType>(hasType('TSUnionType'));
export const isTSParenthesizedType = predicate<t.TSParenthesizedType>(
  hasType('TSParenthesizedType'),
);
export const isTSLiteralType = predicate<t.TSLiteralType>(hasType('TSLiteralType'));
export const isTSStringKeyword = predicate<t.TSStringKeyword>(
  hasType('TSStringKeyword'),
);
export const isTSBigIntKeyword = predicate<t.TSBigIntKeyword>(hasType('TSBigIntKeyword'));
export const isTSBooleanKeyword = predicate<t.TSBooleanKeyword>(
  hasType('TSBooleanKeyword'),
);
export const isTSNumberKeyword = predicate<t.TSNumberKeyword>(
  hasType('TSNumberKeyword'),
);
