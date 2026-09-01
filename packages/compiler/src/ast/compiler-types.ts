/** Parser-neutral node contracts used by compiler analysis and emission. */

import type * as e from './types';

export type Node = e.BaseNode;
export type Program = e.Program;
export interface File extends e.BaseNode {
  type: 'File';
  program: Program;
}

export type Statement = e.Statement;
export type Expression = e.Expression;

export type Identifier = e.Identifier;
export type ArrayExpression = e.ArrayExpression;
export type ArrayPattern = e.ArrayPattern;
export type ArrowFunctionExpression = e.ArrowFunctionExpression;
export type AwaitExpression = e.AwaitExpression;
export type AssignmentExpression = e.AssignmentExpression;
export type AssignmentPattern = e.AssignmentPattern;
export type BinaryExpression = e.BinaryExpression;
export type BlockStatement = e.BlockStatement;
export type BreakStatement = e.BreakStatement;
export type CallExpression = e.CallExpression;
export type ChainExpression = e.ChainExpression;
export type ConditionalExpression = e.ConditionalExpression;
export type ClassDeclaration = e.ClassDeclaration;
export type EmptyStatement = e.EmptyStatement;
export type ExportDefaultDeclaration = e.ExportDefaultDeclaration;
export type ExportNamedDeclaration = e.ExportNamedDeclaration;
export type ExportSpecifier = e.ExportSpecifier;
export type ExpressionStatement = e.ExpressionStatement;
export type ForOfStatement = e.ForOfStatement;
export type FunctionDeclaration = e.FunctionDeclaration;
export type FunctionExpression = e.FunctionExpression;
export type IfStatement = e.IfStatement;
export type ImportDeclaration = e.ImportDeclaration;
export type ImportDefaultSpecifier = e.ImportDefaultSpecifier;
export type ImportSpecifier = e.ImportSpecifier;
export type JSXAttribute = e.JSXAttribute;
export type JSXElement = e.JSXElement;
export type JSXExpressionContainer = e.JSXExpressionContainer;
export type JSXEmptyExpression = e.JSXEmptyExpression;
export type JSXFragment = e.JSXFragment;
export type JSXIdentifier = e.JSXIdentifier;
export type JSXMemberExpression = e.JSXMemberExpression;
export type JSXNamespacedName = e.JSXNamespacedName;
export type JSXOpeningElement = e.JSXOpeningElement;
export type JSXSpreadAttribute = e.JSXSpreadAttribute;
export type JSXSpreadChild = e.JSXSpreadChild;
export type JSXText = e.JSXText;
export type LogicalExpression = e.LogicalExpression;
export type MemberExpression = e.MemberExpression;
export type MetaProperty = e.MetaProperty;
export type NewExpression = e.NewExpression;
export type ObjectExpression = e.ObjectExpression;
export type ObjectPattern = e.ObjectPattern;
export type ObjectProperty = e.Property;
export type OptionalCallExpression = e.CallExpression;
export type OptionalMemberExpression = e.MemberExpression;
export type RestElement = e.RestElement;
export type ReturnStatement = e.ReturnStatement;
export type SpreadElement = e.SpreadElement;
export type SwitchCase = e.SwitchCase;
export type SwitchStatement = e.SwitchStatement;
export type TemplateLiteral = e.TemplateLiteral;
export type UnaryExpression = e.UnaryExpression;
export type UpdateExpression = e.UpdateExpression;
export type VariableDeclaration = e.VariableDeclaration;
export type VariableDeclarator = e.VariableDeclarator;
export type YieldExpression = e.YieldExpression;
export type StringLiteral = e.StringLiteral;
export type NumericLiteral = e.NumericLiteral;
export type BooleanLiteral = e.BooleanLiteral;
export type NullLiteral = e.NullLiteral;
export type BigIntLiteral = e.Literal & { value: bigint };
export type Function =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunctionExpression;

export type LVal = e.Pattern | TSParameterProperty;

export interface Super extends e.BaseNode {
  type: 'Super';
}

export interface PrivateName extends e.BaseNode {
  type: 'PrivateName';
  id: Identifier;
}

export interface ArgumentPlaceholder extends e.BaseNode {
  type: 'ArgumentPlaceholder';
}

export interface V8IntrinsicIdentifier extends e.BaseNode {
  type: 'V8IntrinsicIdentifier';
  name: string;
}

export interface TypeScriptNode extends e.BaseNode {
  type: `TS${string}`;
}

export type TSType = TypeScriptNode;
export type TSTypeElement = TypeScriptNode;
export type TypeAnnotation = TypeScriptNode;

export interface TSTypeAnnotation extends TypeScriptNode {
  type: 'TSTypeAnnotation';
  typeAnnotation: TSType;
}

export interface TSTypeReference extends TypeScriptNode {
  type: 'TSTypeReference';
  typeName: Identifier | TypeScriptNode;
}

export interface TSUnionType extends TypeScriptNode {
  type: 'TSUnionType';
  types: TSType[];
}

export interface TSParenthesizedType extends TypeScriptNode {
  type: 'TSParenthesizedType';
  typeAnnotation: TSType;
}

export interface TSLiteralType extends TypeScriptNode {
  type: 'TSLiteralType';
  literal: Expression;
}

export interface TSTypeAliasDeclaration extends TypeScriptNode {
  type: 'TSTypeAliasDeclaration';
  id: Identifier;
  typeAnnotation: TSType;
}

export interface TSInterfaceBody extends TypeScriptNode {
  type: 'TSInterfaceBody';
  body: TSTypeElement[];
}

export interface TSInterfaceDeclaration extends TypeScriptNode {
  type: 'TSInterfaceDeclaration';
  id: Identifier;
  body: TSInterfaceBody;
}

export interface TSPropertySignature extends TypeScriptNode {
  type: 'TSPropertySignature';
  computed: boolean;
  key: Expression | PrivateName;
  typeAnnotation?: TSTypeAnnotation | null;
}

export interface TSUndefinedKeyword extends TypeScriptNode {
  type: 'TSUndefinedKeyword';
}

export interface TSNullKeyword extends TypeScriptNode {
  type: 'TSNullKeyword';
}

export interface TSSymbolKeyword extends TypeScriptNode {
  type: 'TSSymbolKeyword';
}

export interface TSStringKeyword extends TypeScriptNode {
  type: 'TSStringKeyword';
}

export interface TSBigIntKeyword extends TypeScriptNode {
  type: 'TSBigIntKeyword';
}

export interface TSBooleanKeyword extends TypeScriptNode {
  type: 'TSBooleanKeyword';
}

export interface TSNumberKeyword extends TypeScriptNode {
  type: 'TSNumberKeyword';
}

export interface TSParameterProperty extends TypeScriptNode {
  type: 'TSParameterProperty';
  parameter: e.Pattern;
}

export interface TSAsExpression extends TypeScriptNode {
  type: 'TSAsExpression';
  expression: e.Expression;
  typeAnnotation: TSType;
}

export interface TSTypeAssertion extends TypeScriptNode {
  type: 'TSTypeAssertion';
  expression: e.Expression;
  typeAnnotation: TSType;
}

export interface TSNonNullExpression extends TypeScriptNode {
  type: 'TSNonNullExpression';
  expression: e.Expression;
}

export interface TSSatisfiesExpression extends TypeScriptNode {
  type: 'TSSatisfiesExpression';
  expression: e.Expression;
  typeAnnotation: TSType;
}

export interface TSInstantiationExpression extends TypeScriptNode {
  type: 'TSInstantiationExpression';
  expression: e.Expression;
}

export interface TypeCastExpression extends e.BaseNode {
  type: 'TypeCastExpression';
  expression: e.Expression;
  typeAnnotation: e.BaseNode;
}

export type TransparentExpression =
  | TSAsExpression
  | TSTypeAssertion
  | TSNonNullExpression
  | TSSatisfiesExpression
  | TSInstantiationExpression
  | TypeCastExpression;

export interface TSTypeLiteral extends TypeScriptNode {
  type: 'TSTypeLiteral';
  members: TSTypeElement[];
}
