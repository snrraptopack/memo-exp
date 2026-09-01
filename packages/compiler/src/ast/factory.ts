/**
 * ESTree node construction exposed through the compiler's transitional node
 * typings. The type-only Babel import disappears with the remaining public AST
 * type migration; every function in this module already constructs plain
 * ESTree nodes at runtime.
 */

import type * as t from './compiler-types';
import type { AstCompatibilityModule } from './compiler-types';
import * as estree from './builders';

export const identifier = estree.identifier as unknown as AstCompatibilityModule['identifier'];
export const stringLiteral = estree.stringLiteral as unknown as AstCompatibilityModule['stringLiteral'];
export const numericLiteral = estree.numericLiteral as unknown as AstCompatibilityModule['numericLiteral'];
export const booleanLiteral = estree.booleanLiteral as unknown as AstCompatibilityModule['booleanLiteral'];
export const nullLiteral = estree.nullLiteral as unknown as AstCompatibilityModule['nullLiteral'];
export const callExpression = estree.callExpression as unknown as AstCompatibilityModule['callExpression'];
export const memberExpression = estree.memberExpression as unknown as AstCompatibilityModule['memberExpression'];
export const optionalMemberExpression =
  estree.optionalMemberExpression as unknown as AstCompatibilityModule['optionalMemberExpression'];
export const arrayExpression = estree.arrayExpression as unknown as AstCompatibilityModule['arrayExpression'];
export const objectExpression = estree.objectExpression as unknown as AstCompatibilityModule['objectExpression'];
export const objectProperty = estree.objectProperty as unknown as AstCompatibilityModule['objectProperty'];
export const spreadElement = estree.spreadElement as unknown as AstCompatibilityModule['spreadElement'];
export const newExpression = estree.newExpression as unknown as AstCompatibilityModule['newExpression'];
export const binaryExpression = estree.binaryExpression as unknown as AstCompatibilityModule['binaryExpression'];
export const unaryExpression = estree.unaryExpression as unknown as AstCompatibilityModule['unaryExpression'];
export const logicalExpression = estree.logicalExpression as unknown as AstCompatibilityModule['logicalExpression'];
export const assignmentExpression =
  estree.assignmentExpression as unknown as AstCompatibilityModule['assignmentExpression'];
export const conditionalExpression =
  estree.conditionalExpression as unknown as AstCompatibilityModule['conditionalExpression'];
export const sequenceExpression =
  estree.sequenceExpression as unknown as AstCompatibilityModule['sequenceExpression'];
export const assignmentPattern =
  estree.assignmentPattern as unknown as AstCompatibilityModule['assignmentPattern'];
export const functionDeclaration =
  estree.functionDeclaration as unknown as AstCompatibilityModule['functionDeclaration'];
export const arrowFunctionExpression =
  estree.arrowFunctionExpression as unknown as AstCompatibilityModule['arrowFunctionExpression'];
export const blockStatement = estree.blockStatement as unknown as AstCompatibilityModule['blockStatement'];
export const expressionStatement =
  estree.expressionStatement as unknown as AstCompatibilityModule['expressionStatement'];
export const returnStatement = estree.returnStatement as unknown as AstCompatibilityModule['returnStatement'];
export const ifStatement = estree.ifStatement as unknown as AstCompatibilityModule['ifStatement'];
export const forOfStatement = estree.forOfStatement as unknown as AstCompatibilityModule['forOfStatement'];
export const variableDeclaration =
  estree.variableDeclaration as unknown as AstCompatibilityModule['variableDeclaration'];
export const variableDeclarator =
  estree.variableDeclarator as unknown as AstCompatibilityModule['variableDeclarator'];
export const importDeclaration =
  estree.importDeclaration as unknown as AstCompatibilityModule['importDeclaration'];
export const importSpecifier = estree.importSpecifier as unknown as AstCompatibilityModule['importSpecifier'];
export const importDefaultSpecifier =
  estree.importDefaultSpecifier as unknown as AstCompatibilityModule['importDefaultSpecifier'];
export const importNamespaceSpecifier =
  estree.importNamespaceSpecifier as unknown as AstCompatibilityModule['importNamespaceSpecifier'];
export const exportNamedDeclaration =
  estree.exportNamedDeclaration as unknown as AstCompatibilityModule['exportNamedDeclaration'];
export const jsxIdentifier = estree.jsxIdentifier as unknown as AstCompatibilityModule['jsxIdentifier'];
export const jsxAttribute = estree.jsxAttribute as unknown as AstCompatibilityModule['jsxAttribute'];
export const jsxExpressionContainer =
  estree.jsxExpressionContainer as unknown as AstCompatibilityModule['jsxExpressionContainer'];
export const jsxOpeningElement =
  estree.jsxOpeningElement as unknown as AstCompatibilityModule['jsxOpeningElement'];
export const jsxElement = estree.jsxElement as unknown as AstCompatibilityModule['jsxElement'];
export const jsxOpeningFragment =
  estree.jsxOpeningFragment as unknown as AstCompatibilityModule['jsxOpeningFragment'];
export const jsxClosingFragment =
  estree.jsxClosingFragment as unknown as AstCompatibilityModule['jsxClosingFragment'];
export const jsxFragment = estree.jsxFragment as unknown as AstCompatibilityModule['jsxFragment'];

export const updateExpression = ((
  operator: t.UpdateExpression['operator'],
  argument: t.Expression,
  prefix = false,
) => ({ type: 'UpdateExpression', operator, argument, prefix })) as AstCompatibilityModule['updateExpression'];

export const switchCase = ((
  test: t.Expression | null,
  consequent: t.Statement[],
) => ({ type: 'SwitchCase', test, consequent })) as AstCompatibilityModule['switchCase'];

export const switchStatement = ((
  discriminant: t.Expression,
  cases: t.SwitchCase[],
) => ({ type: 'SwitchStatement', discriminant, cases })) as AstCompatibilityModule['switchStatement'];

export const metaProperty = ((meta: t.Identifier, property: t.Identifier) => ({
  type: 'MetaProperty',
  meta,
  property,
})) as AstCompatibilityModule['metaProperty'];

export const tsTypeLiteral = ((members: t.TSTypeElement[] = []) => ({
  type: 'TSTypeLiteral',
  members,
})) as AstCompatibilityModule['tsTypeLiteral'];

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

export const isNode = predicate<AstCompatibilityModule['isNode']>((node) => nodeType(node) !== null);
export const isIdentifier = predicate<AstCompatibilityModule['isIdentifier']>(estree.isIdentifier);
export const isStringLiteral = predicate<AstCompatibilityModule['isStringLiteral']>(isString);
export const isNumericLiteral = predicate<AstCompatibilityModule['isNumericLiteral']>(isNumber);
export const isBooleanLiteral = predicate<AstCompatibilityModule['isBooleanLiteral']>(isBoolean);
export const isNullLiteral = predicate<AstCompatibilityModule['isNullLiteral']>(isNull);
export const isBigIntLiteral = predicate<AstCompatibilityModule['isBigIntLiteral']>(hasType('BigIntLiteral'));
export const isCallExpression = predicate<AstCompatibilityModule['isCallExpression']>(
  hasType('CallExpression'),
);
export const isOptionalCallExpression = predicate<AstCompatibilityModule['isOptionalCallExpression']>((node) =>
  nodeType(node) === 'OptionalCallExpression' ||
  (nodeType(node) === 'CallExpression' &&
    (node as Record<string, unknown>).optional === true),
);
export const isMemberExpression = predicate<AstCompatibilityModule['isMemberExpression']>(
  hasType('MemberExpression'),
);
export const isOptionalMemberExpression = predicate<AstCompatibilityModule['isOptionalMemberExpression']>(
  (node) =>
    nodeType(node) === 'OptionalMemberExpression' ||
    (nodeType(node) === 'MemberExpression' &&
      (node as Record<string, unknown>).optional === true),
);
export const isArrayExpression = predicate<AstCompatibilityModule['isArrayExpression']>(estree.isArrayExpression);
export const isObjectExpression = predicate<AstCompatibilityModule['isObjectExpression']>(
  estree.isObjectExpression,
);
export const isObjectProperty = predicate<AstCompatibilityModule['isObjectProperty']>(isObjectPropertyNode);
export const isFunctionDeclaration = predicate<AstCompatibilityModule['isFunctionDeclaration']>(
  estree.isFunctionDeclaration,
);
export const isFunctionExpression = predicate<AstCompatibilityModule['isFunctionExpression']>(
  hasType('FunctionExpression'),
);
export const isArrowFunctionExpression = predicate<AstCompatibilityModule['isArrowFunctionExpression']>(
  estree.isArrowFunctionExpression,
);
export const isFunction = predicate<AstCompatibilityModule['isFunction']>(
  hasType(
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
  ),
);
export const isVariableDeclaration = predicate<AstCompatibilityModule['isVariableDeclaration']>(
  estree.isVariableDeclaration,
);
export const isVariableDeclarator = predicate<AstCompatibilityModule['isVariableDeclarator']>(
  estree.isVariableDeclarator,
);
export const isBlockStatement = predicate<AstCompatibilityModule['isBlockStatement']>(estree.isBlockStatement);
export const isReturnStatement = predicate<AstCompatibilityModule['isReturnStatement']>(estree.isReturnStatement);
export const isIfStatement = predicate<AstCompatibilityModule['isIfStatement']>(estree.isIfStatement);
export const isExpressionStatement = predicate<AstCompatibilityModule['isExpressionStatement']>(
  estree.isExpressionStatement,
);
export const isAssignmentExpression = predicate<AstCompatibilityModule['isAssignmentExpression']>(
  estree.isAssignmentExpression,
);
export const isUpdateExpression = predicate<AstCompatibilityModule['isUpdateExpression']>(
  hasType('UpdateExpression'),
);
export const isUnaryExpression = predicate<AstCompatibilityModule['isUnaryExpression']>(estree.isUnaryExpression);
export const isLogicalExpression = predicate<AstCompatibilityModule['isLogicalExpression']>(
  estree.isLogicalExpression,
);
export const isConditionalExpression = predicate<AstCompatibilityModule['isConditionalExpression']>(
  estree.isConditionalExpression,
);
export const isExpression = predicate<AstCompatibilityModule['isExpression']>((node) => {
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
export const isJSXElement = predicate<AstCompatibilityModule['isJSXElement']>(estree.isJSXElement);
export const isJSXFragment = predicate<AstCompatibilityModule['isJSXFragment']>(estree.isJSXFragment);
export const isJSXAttribute = predicate<AstCompatibilityModule['isJSXAttribute']>(estree.isJSXAttribute);
export const isJSXSpreadAttribute = predicate<AstCompatibilityModule['isJSXSpreadAttribute']>(
  estree.isJSXSpreadAttribute,
);
export const isJSXExpressionContainer = predicate<AstCompatibilityModule['isJSXExpressionContainer']>(
  estree.isJSXExpressionContainer,
);
export const isJSXIdentifier = predicate<AstCompatibilityModule['isJSXIdentifier']>(estree.isJSXIdentifier);
export const isJSXText = predicate<AstCompatibilityModule['isJSXText']>(estree.isJSXText);
export const isJSXEmptyExpression = predicate<AstCompatibilityModule['isJSXEmptyExpression']>(
  hasType('JSXEmptyExpression'),
);
export const isJSXNamespacedName = predicate<AstCompatibilityModule['isJSXNamespacedName']>(
  hasType('JSXNamespacedName'),
);
export const isObjectPattern = predicate<AstCompatibilityModule['isObjectPattern']>(hasType('ObjectPattern'));
export const isArrayPattern = predicate<AstCompatibilityModule['isArrayPattern']>(hasType('ArrayPattern'));
export const isAssignmentPattern = predicate<AstCompatibilityModule['isAssignmentPattern']>(
  hasType('AssignmentPattern'),
);
export const isRestElement = predicate<AstCompatibilityModule['isRestElement']>(hasType('RestElement'));
export const isSpreadElement = predicate<AstCompatibilityModule['isSpreadElement']>(hasType('SpreadElement'));
export const isExportNamedDeclaration = predicate<AstCompatibilityModule['isExportNamedDeclaration']>(
  hasType('ExportNamedDeclaration'),
);
export const isExportDefaultDeclaration = predicate<AstCompatibilityModule['isExportDefaultDeclaration']>(
  hasType('ExportDefaultDeclaration'),
);
export const isExportSpecifier = predicate<AstCompatibilityModule['isExportSpecifier']>(
  hasType('ExportSpecifier'),
);
export const isImportDeclaration = predicate<AstCompatibilityModule['isImportDeclaration']>(
  hasType('ImportDeclaration'),
);
export const isImportSpecifier = predicate<AstCompatibilityModule['isImportSpecifier']>(hasType('ImportSpecifier'));
export const isImportDefaultSpecifier = predicate<AstCompatibilityModule['isImportDefaultSpecifier']>(
  hasType('ImportDefaultSpecifier'),
);
export const isSwitchStatement = predicate<AstCompatibilityModule['isSwitchStatement']>(
  hasType('SwitchStatement'),
);
export const isBreakStatement = predicate<AstCompatibilityModule['isBreakStatement']>(hasType('BreakStatement'));
export const isEmptyStatement = predicate<AstCompatibilityModule['isEmptyStatement']>(hasType('EmptyStatement'));
export const isAwaitExpression = predicate<AstCompatibilityModule['isAwaitExpression']>(hasType('AwaitExpression'));
export const isYieldExpression = predicate<AstCompatibilityModule['isYieldExpression']>(hasType('YieldExpression'));
export const isNewExpression = predicate<AstCompatibilityModule['isNewExpression']>(hasType('NewExpression'));
export const isTemplateLiteral = predicate<AstCompatibilityModule['isTemplateLiteral']>(hasType('TemplateLiteral'));
export const isSuper = predicate<AstCompatibilityModule['isSuper']>(hasType('Super'));
export const isPrivateName = predicate<AstCompatibilityModule['isPrivateName']>(hasType('PrivateName'));
export const isClassDeclaration = predicate<AstCompatibilityModule['isClassDeclaration']>(
  hasType('ClassDeclaration'),
);
export const isTypeCastExpression = predicate<AstCompatibilityModule['isTypeCastExpression']>(
  hasType('TypeCastExpression'),
);
export const isTypeScript = predicate<AstCompatibilityModule['isTypeScript']>((node) =>
  nodeType(node)?.startsWith('TS') === true,
);

export const isTSAsExpression = predicate<AstCompatibilityModule['isTSAsExpression']>(hasType('TSAsExpression'));
export const isTSTypeAssertion = predicate<AstCompatibilityModule['isTSTypeAssertion']>(
  hasType('TSTypeAssertion'),
);
export const isTSNonNullExpression = predicate<AstCompatibilityModule['isTSNonNullExpression']>(
  hasType('TSNonNullExpression'),
);
export const isTSSatisfiesExpression = predicate<AstCompatibilityModule['isTSSatisfiesExpression']>(
  hasType('TSSatisfiesExpression'),
);
export const isTSInstantiationExpression = predicate<AstCompatibilityModule['isTSInstantiationExpression']>(
  hasType('TSInstantiationExpression'),
);
export const isTSTypeAliasDeclaration = predicate<AstCompatibilityModule['isTSTypeAliasDeclaration']>(
  hasType('TSTypeAliasDeclaration'),
);
export const isTSInterfaceDeclaration = predicate<AstCompatibilityModule['isTSInterfaceDeclaration']>(
  hasType('TSInterfaceDeclaration'),
);
export const isTSParameterProperty = predicate<AstCompatibilityModule['isTSParameterProperty']>(
  hasType('TSParameterProperty'),
);
export const isTSTypeAnnotation = predicate<AstCompatibilityModule['isTSTypeAnnotation']>(
  hasType('TSTypeAnnotation'),
);
export const isTSTypeReference = predicate<AstCompatibilityModule['isTSTypeReference']>(
  hasType('TSTypeReference'),
);
export const isTSTypeLiteral = predicate<AstCompatibilityModule['isTSTypeLiteral']>(hasType('TSTypeLiteral'));
export const isTSPropertySignature = predicate<AstCompatibilityModule['isTSPropertySignature']>(
  hasType('TSPropertySignature'),
);
export const isTSUndefinedKeyword = predicate<AstCompatibilityModule['isTSUndefinedKeyword']>(
  hasType('TSUndefinedKeyword'),
);
export const isTSNullKeyword = predicate<AstCompatibilityModule['isTSNullKeyword']>(hasType('TSNullKeyword'));
export const isTSSymbolKeyword = predicate<AstCompatibilityModule['isTSSymbolKeyword']>(hasType('TSSymbolKeyword'));
export const isTSUnionType = predicate<AstCompatibilityModule['isTSUnionType']>(hasType('TSUnionType'));
export const isTSParenthesizedType = predicate<AstCompatibilityModule['isTSParenthesizedType']>(
  hasType('TSParenthesizedType'),
);
export const isTSLiteralType = predicate<AstCompatibilityModule['isTSLiteralType']>(hasType('TSLiteralType'));
export const isTSStringKeyword = predicate<AstCompatibilityModule['isTSStringKeyword']>(
  hasType('TSStringKeyword'),
);
export const isTSBigIntKeyword = predicate<AstCompatibilityModule['isTSBigIntKeyword']>(hasType('TSBigIntKeyword'));
export const isTSBooleanKeyword = predicate<AstCompatibilityModule['isTSBooleanKeyword']>(
  hasType('TSBooleanKeyword'),
);
export const isTSNumberKeyword = predicate<AstCompatibilityModule['isTSNumberKeyword']>(
  hasType('TSNumberKeyword'),
);
