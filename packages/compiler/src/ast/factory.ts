/**
 * ESTree node construction exposed through the compiler's transitional node
 * typings. The type-only Babel import disappears with the remaining public AST
 * type migration; every function in this module already constructs plain
 * ESTree nodes at runtime.
 */

import type * as t from '@babel/types';
import * as estree from './builders';

export const identifier = estree.identifier as unknown as typeof t.identifier;
export const stringLiteral = estree.stringLiteral as unknown as typeof t.stringLiteral;
export const numericLiteral = estree.numericLiteral as unknown as typeof t.numericLiteral;
export const booleanLiteral = estree.booleanLiteral as unknown as typeof t.booleanLiteral;
export const nullLiteral = estree.nullLiteral as unknown as typeof t.nullLiteral;
export const callExpression = estree.callExpression as unknown as typeof t.callExpression;
export const memberExpression = estree.memberExpression as unknown as typeof t.memberExpression;
export const optionalMemberExpression =
  estree.optionalMemberExpression as unknown as typeof t.optionalMemberExpression;
export const arrayExpression = estree.arrayExpression as unknown as typeof t.arrayExpression;
export const objectExpression = estree.objectExpression as unknown as typeof t.objectExpression;
export const objectProperty = estree.objectProperty as unknown as typeof t.objectProperty;
export const spreadElement = estree.spreadElement as unknown as typeof t.spreadElement;
export const newExpression = estree.newExpression as unknown as typeof t.newExpression;
export const binaryExpression = estree.binaryExpression as unknown as typeof t.binaryExpression;
export const unaryExpression = estree.unaryExpression as unknown as typeof t.unaryExpression;
export const logicalExpression = estree.logicalExpression as unknown as typeof t.logicalExpression;
export const assignmentExpression =
  estree.assignmentExpression as unknown as typeof t.assignmentExpression;
export const conditionalExpression =
  estree.conditionalExpression as unknown as typeof t.conditionalExpression;
export const sequenceExpression =
  estree.sequenceExpression as unknown as typeof t.sequenceExpression;
export const assignmentPattern =
  estree.assignmentPattern as unknown as typeof t.assignmentPattern;
export const functionDeclaration =
  estree.functionDeclaration as unknown as typeof t.functionDeclaration;
export const arrowFunctionExpression =
  estree.arrowFunctionExpression as unknown as typeof t.arrowFunctionExpression;
export const blockStatement = estree.blockStatement as unknown as typeof t.blockStatement;
export const expressionStatement =
  estree.expressionStatement as unknown as typeof t.expressionStatement;
export const returnStatement = estree.returnStatement as unknown as typeof t.returnStatement;
export const ifStatement = estree.ifStatement as unknown as typeof t.ifStatement;
export const forOfStatement = estree.forOfStatement as unknown as typeof t.forOfStatement;
export const variableDeclaration =
  estree.variableDeclaration as unknown as typeof t.variableDeclaration;
export const variableDeclarator =
  estree.variableDeclarator as unknown as typeof t.variableDeclarator;
export const importDeclaration =
  estree.importDeclaration as unknown as typeof t.importDeclaration;
export const importSpecifier = estree.importSpecifier as unknown as typeof t.importSpecifier;
export const importDefaultSpecifier =
  estree.importDefaultSpecifier as unknown as typeof t.importDefaultSpecifier;
export const importNamespaceSpecifier =
  estree.importNamespaceSpecifier as unknown as typeof t.importNamespaceSpecifier;
export const exportNamedDeclaration =
  estree.exportNamedDeclaration as unknown as typeof t.exportNamedDeclaration;
export const jsxIdentifier = estree.jsxIdentifier as unknown as typeof t.jsxIdentifier;
export const jsxAttribute = estree.jsxAttribute as unknown as typeof t.jsxAttribute;
export const jsxExpressionContainer =
  estree.jsxExpressionContainer as unknown as typeof t.jsxExpressionContainer;
export const jsxOpeningElement =
  estree.jsxOpeningElement as unknown as typeof t.jsxOpeningElement;
export const jsxElement = estree.jsxElement as unknown as typeof t.jsxElement;
export const jsxOpeningFragment =
  estree.jsxOpeningFragment as unknown as typeof t.jsxOpeningFragment;
export const jsxClosingFragment =
  estree.jsxClosingFragment as unknown as typeof t.jsxClosingFragment;
export const jsxFragment = estree.jsxFragment as unknown as typeof t.jsxFragment;

export const updateExpression = ((
  operator: t.UpdateExpression['operator'],
  argument: t.Expression,
  prefix = false,
) => ({ type: 'UpdateExpression', operator, argument, prefix })) as typeof t.updateExpression;

export const switchCase = ((
  test: t.Expression | null,
  consequent: t.Statement[],
) => ({ type: 'SwitchCase', test, consequent })) as typeof t.switchCase;

export const switchStatement = ((
  discriminant: t.Expression,
  cases: t.SwitchCase[],
) => ({ type: 'SwitchStatement', discriminant, cases })) as typeof t.switchStatement;

export const metaProperty = ((meta: t.Identifier, property: t.Identifier) => ({
  type: 'MetaProperty',
  meta,
  property,
})) as typeof t.metaProperty;

export const tsTypeLiteral = ((members: t.TSTypeElement[] = []) => ({
  type: 'TSTypeLiteral',
  members,
})) as typeof t.tsTypeLiteral;

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

function predicate<T>(check: (node: unknown) => boolean): T {
  return ((node: unknown, options?: object | null) =>
    check(node) && matchesOptions(node, options)) as unknown as T;
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

export const isNode = predicate<typeof t.isNode>((node) => nodeType(node) !== null);
export const isIdentifier = predicate<typeof t.isIdentifier>(estree.isIdentifier);
export const isStringLiteral = predicate<typeof t.isStringLiteral>(isString);
export const isNumericLiteral = predicate<typeof t.isNumericLiteral>(isNumber);
export const isBooleanLiteral = predicate<typeof t.isBooleanLiteral>(isBoolean);
export const isNullLiteral = predicate<typeof t.isNullLiteral>(isNull);
export const isBigIntLiteral = predicate<typeof t.isBigIntLiteral>(hasType('BigIntLiteral'));
export const isCallExpression = predicate<typeof t.isCallExpression>(
  hasType('CallExpression'),
);
export const isOptionalCallExpression = predicate<typeof t.isOptionalCallExpression>((node) =>
  nodeType(node) === 'OptionalCallExpression' ||
  (nodeType(node) === 'CallExpression' &&
    (node as Record<string, unknown>).optional === true),
);
export const isMemberExpression = predicate<typeof t.isMemberExpression>(
  hasType('MemberExpression'),
);
export const isOptionalMemberExpression = predicate<typeof t.isOptionalMemberExpression>(
  (node) =>
    nodeType(node) === 'OptionalMemberExpression' ||
    (nodeType(node) === 'MemberExpression' &&
      (node as Record<string, unknown>).optional === true),
);
export const isArrayExpression = predicate<typeof t.isArrayExpression>(estree.isArrayExpression);
export const isObjectExpression = predicate<typeof t.isObjectExpression>(
  estree.isObjectExpression,
);
export const isObjectProperty = predicate<typeof t.isObjectProperty>(isObjectPropertyNode);
export const isFunctionDeclaration = predicate<typeof t.isFunctionDeclaration>(
  estree.isFunctionDeclaration,
);
export const isFunctionExpression = predicate<typeof t.isFunctionExpression>(
  hasType('FunctionExpression'),
);
export const isArrowFunctionExpression = predicate<typeof t.isArrowFunctionExpression>(
  estree.isArrowFunctionExpression,
);
export const isFunction = predicate<typeof t.isFunction>(
  hasType(
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
  ),
);
export const isVariableDeclaration = predicate<typeof t.isVariableDeclaration>(
  estree.isVariableDeclaration,
);
export const isVariableDeclarator = predicate<typeof t.isVariableDeclarator>(
  estree.isVariableDeclarator,
);
export const isBlockStatement = predicate<typeof t.isBlockStatement>(estree.isBlockStatement);
export const isReturnStatement = predicate<typeof t.isReturnStatement>(estree.isReturnStatement);
export const isIfStatement = predicate<typeof t.isIfStatement>(estree.isIfStatement);
export const isExpressionStatement = predicate<typeof t.isExpressionStatement>(
  estree.isExpressionStatement,
);
export const isAssignmentExpression = predicate<typeof t.isAssignmentExpression>(
  estree.isAssignmentExpression,
);
export const isUpdateExpression = predicate<typeof t.isUpdateExpression>(
  hasType('UpdateExpression'),
);
export const isUnaryExpression = predicate<typeof t.isUnaryExpression>(estree.isUnaryExpression);
export const isLogicalExpression = predicate<typeof t.isLogicalExpression>(
  estree.isLogicalExpression,
);
export const isConditionalExpression = predicate<typeof t.isConditionalExpression>(
  estree.isConditionalExpression,
);
export const isExpression = predicate<typeof t.isExpression>((node) => {
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
export const isJSXElement = predicate<typeof t.isJSXElement>(estree.isJSXElement);
export const isJSXFragment = predicate<typeof t.isJSXFragment>(estree.isJSXFragment);
export const isJSXAttribute = predicate<typeof t.isJSXAttribute>(estree.isJSXAttribute);
export const isJSXSpreadAttribute = predicate<typeof t.isJSXSpreadAttribute>(
  estree.isJSXSpreadAttribute,
);
export const isJSXExpressionContainer = predicate<typeof t.isJSXExpressionContainer>(
  estree.isJSXExpressionContainer,
);
export const isJSXIdentifier = predicate<typeof t.isJSXIdentifier>(estree.isJSXIdentifier);
export const isJSXText = predicate<typeof t.isJSXText>(estree.isJSXText);
export const isJSXEmptyExpression = predicate<typeof t.isJSXEmptyExpression>(
  hasType('JSXEmptyExpression'),
);
export const isJSXNamespacedName = predicate<typeof t.isJSXNamespacedName>(
  hasType('JSXNamespacedName'),
);
export const isObjectPattern = predicate<typeof t.isObjectPattern>(hasType('ObjectPattern'));
export const isArrayPattern = predicate<typeof t.isArrayPattern>(hasType('ArrayPattern'));
export const isAssignmentPattern = predicate<typeof t.isAssignmentPattern>(
  hasType('AssignmentPattern'),
);
export const isRestElement = predicate<typeof t.isRestElement>(hasType('RestElement'));
export const isSpreadElement = predicate<typeof t.isSpreadElement>(hasType('SpreadElement'));
export const isExportNamedDeclaration = predicate<typeof t.isExportNamedDeclaration>(
  hasType('ExportNamedDeclaration'),
);
export const isExportDefaultDeclaration = predicate<typeof t.isExportDefaultDeclaration>(
  hasType('ExportDefaultDeclaration'),
);
export const isExportSpecifier = predicate<typeof t.isExportSpecifier>(
  hasType('ExportSpecifier'),
);
export const isImportDeclaration = predicate<typeof t.isImportDeclaration>(
  hasType('ImportDeclaration'),
);
export const isImportSpecifier = predicate<typeof t.isImportSpecifier>(hasType('ImportSpecifier'));
export const isImportDefaultSpecifier = predicate<typeof t.isImportDefaultSpecifier>(
  hasType('ImportDefaultSpecifier'),
);
export const isSwitchStatement = predicate<typeof t.isSwitchStatement>(
  hasType('SwitchStatement'),
);
export const isBreakStatement = predicate<typeof t.isBreakStatement>(hasType('BreakStatement'));
export const isEmptyStatement = predicate<typeof t.isEmptyStatement>(hasType('EmptyStatement'));
export const isAwaitExpression = predicate<typeof t.isAwaitExpression>(hasType('AwaitExpression'));
export const isYieldExpression = predicate<typeof t.isYieldExpression>(hasType('YieldExpression'));
export const isNewExpression = predicate<typeof t.isNewExpression>(hasType('NewExpression'));
export const isTemplateLiteral = predicate<typeof t.isTemplateLiteral>(hasType('TemplateLiteral'));
export const isSuper = predicate<typeof t.isSuper>(hasType('Super'));
export const isPrivateName = predicate<typeof t.isPrivateName>(hasType('PrivateName'));
export const isClassDeclaration = predicate<typeof t.isClassDeclaration>(
  hasType('ClassDeclaration'),
);
export const isTypeCastExpression = predicate<typeof t.isTypeCastExpression>(
  hasType('TypeCastExpression'),
);
export const isTypeScript = predicate<typeof t.isTypeScript>((node) =>
  nodeType(node)?.startsWith('TS') === true,
);

export const isTSAsExpression = predicate<typeof t.isTSAsExpression>(hasType('TSAsExpression'));
export const isTSTypeAssertion = predicate<typeof t.isTSTypeAssertion>(
  hasType('TSTypeAssertion'),
);
export const isTSNonNullExpression = predicate<typeof t.isTSNonNullExpression>(
  hasType('TSNonNullExpression'),
);
export const isTSSatisfiesExpression = predicate<typeof t.isTSSatisfiesExpression>(
  hasType('TSSatisfiesExpression'),
);
export const isTSInstantiationExpression = predicate<typeof t.isTSInstantiationExpression>(
  hasType('TSInstantiationExpression'),
);
export const isTSTypeAliasDeclaration = predicate<typeof t.isTSTypeAliasDeclaration>(
  hasType('TSTypeAliasDeclaration'),
);
export const isTSInterfaceDeclaration = predicate<typeof t.isTSInterfaceDeclaration>(
  hasType('TSInterfaceDeclaration'),
);
export const isTSParameterProperty = predicate<typeof t.isTSParameterProperty>(
  hasType('TSParameterProperty'),
);
export const isTSTypeAnnotation = predicate<typeof t.isTSTypeAnnotation>(
  hasType('TSTypeAnnotation'),
);
export const isTSTypeReference = predicate<typeof t.isTSTypeReference>(
  hasType('TSTypeReference'),
);
export const isTSTypeLiteral = predicate<typeof t.isTSTypeLiteral>(hasType('TSTypeLiteral'));
export const isTSPropertySignature = predicate<typeof t.isTSPropertySignature>(
  hasType('TSPropertySignature'),
);
export const isTSUndefinedKeyword = predicate<typeof t.isTSUndefinedKeyword>(
  hasType('TSUndefinedKeyword'),
);
export const isTSNullKeyword = predicate<typeof t.isTSNullKeyword>(hasType('TSNullKeyword'));
export const isTSSymbolKeyword = predicate<typeof t.isTSSymbolKeyword>(hasType('TSSymbolKeyword'));
export const isTSUnionType = predicate<typeof t.isTSUnionType>(hasType('TSUnionType'));
export const isTSParenthesizedType = predicate<typeof t.isTSParenthesizedType>(
  hasType('TSParenthesizedType'),
);
export const isTSLiteralType = predicate<typeof t.isTSLiteralType>(hasType('TSLiteralType'));
export const isTSStringKeyword = predicate<typeof t.isTSStringKeyword>(
  hasType('TSStringKeyword'),
);
export const isTSBigIntKeyword = predicate<typeof t.isTSBigIntKeyword>(hasType('TSBigIntKeyword'));
export const isTSBooleanKeyword = predicate<typeof t.isTSBooleanKeyword>(
  hasType('TSBooleanKeyword'),
);
export const isTSNumberKeyword = predicate<typeof t.isTSNumberKeyword>(
  hasType('TSNumberKeyword'),
);
