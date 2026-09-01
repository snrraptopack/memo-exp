/**
 * Pure ESTree specification with JSX extensions for @memoized-dom/compiler.
 *
 * Targets the official ESTree and JSX specifications. Coverage expands as
 * production passes migrate onto this toolkit:
 * https://github.com/estree/estree
 * https://github.com/facebook/jsx/blob/main/AST.md
 *
 * ZERO dependencies on Babel or proprietary AST formats.
 */

export interface SourceLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
  source?: string | null;
}

export interface BaseNode {
  type: string;
  loc?: SourceLocation | null;
  range?: [number, number];
  leadingComments?: unknown[] | null;
  trailingComments?: unknown[] | null;
  innerComments?: unknown[] | null;
}

export type ASTNode =
  | Statement
  | Expression
  | Pattern
  | VariableDeclarator
  | Property
  | SpreadElement
  | TemplateElement
  | SwitchCase
  | CatchClause
  | ClassBody
  | MethodDefinition
  | ImportSpecifier
  | ImportDefaultSpecifier
  | ImportNamespaceSpecifier
  | ExportSpecifier
  | JSXChild
  | JSXOpeningElement
  | JSXClosingElement
  | JSXOpeningFragment
  | JSXClosingFragment
  | JSXAttribute
  | JSXSpreadAttribute
  | JSXIdentifier
  | JSXMemberExpression
  | JSXNamespacedName;

export interface Program extends BaseNode {
  type: 'Program';
  sourceType: 'script' | 'module';
  body: Statement[];
}

export type Statement =
  | ExpressionStatement
  | BlockStatement
  | EmptyStatement
  | DebuggerStatement
  | WithStatement
  | ReturnStatement
  | LabeledStatement
  | BreakStatement
  | ContinueStatement
  | IfStatement
  | SwitchStatement
  | ThrowStatement
  | TryStatement
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | ForInStatement
  | ForOfStatement
  | Declaration;

export type Declaration =
  | FunctionDeclaration
  | VariableDeclaration
  | ClassDeclaration
  | ImportDeclaration
  | ExportNamedDeclaration
  | ExportDefaultDeclaration
  | ExportAllDeclaration;

export type Expression =
  | Identifier
  | Literal
  | ThisExpression
  | ArrayExpression
  | ObjectExpression
  | FunctionExpression
  | ArrowFunctionExpression
  | YieldExpression
  | UnaryExpression
  | UpdateExpression
  | BinaryExpression
  | AssignmentExpression
  | LogicalExpression
  | MemberExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | SequenceExpression
  | TemplateLiteral
  | TaggedTemplateExpression
  | ClassExpression
  | MetaProperty
  | AwaitExpression
  | ChainExpression
  | ImportExpression
  | JSXElement
  | JSXFragment;

export interface Identifier extends BaseNode {
  type: 'Identifier';
  name: string;
  typeAnnotation?: BaseNode | null;
}

export interface Literal extends BaseNode {
  type: 'Literal';
  value: string | number | boolean | null | RegExp | bigint;
  raw?: string;
  regex?: { pattern: string; flags: string };
  bigint?: string;
}

export type StringLiteral = Literal & { value: string };
export type NumericLiteral = Literal & { value: number };
export type BooleanLiteral = Literal & { value: boolean };
export type NullLiteral = Literal & { value: null };

export interface ThisExpression extends BaseNode {
  type: 'ThisExpression';
}

export interface ArrayExpression extends BaseNode {
  type: 'ArrayExpression';
  elements: Array<Expression | SpreadElement | null>;
}

export interface ObjectExpression extends BaseNode {
  type: 'ObjectExpression';
  properties: Array<Property | SpreadElement>;
}

export interface Property extends BaseNode {
  type: 'Property';
  key: Expression;
  value: Expression | Pattern;
  kind: 'init' | 'get' | 'set';
  method: boolean;
  shorthand: boolean;
  computed: boolean;
}

export interface SpreadElement extends BaseNode {
  type: 'SpreadElement';
  argument: Expression;
}

export interface FunctionDeclaration extends BaseNode {
  type: 'FunctionDeclaration';
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement;
  generator: boolean;
  async: boolean;
  returnType?: BaseNode | null;
  typeParameters?: BaseNode | null;
}

export interface FunctionExpression extends BaseNode {
  type: 'FunctionExpression';
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement;
  generator: boolean;
  async: boolean;
  returnType?: BaseNode | null;
  typeParameters?: BaseNode | null;
}

export interface ArrowFunctionExpression extends BaseNode {
  type: 'ArrowFunctionExpression';
  params: Pattern[];
  body: BlockStatement | Expression;
  generator: boolean;
  async: boolean;
  expression: boolean;
  returnType?: BaseNode | null;
  typeParameters?: BaseNode | null;
}

export interface VariableDeclaration extends BaseNode {
  type: 'VariableDeclaration';
  declarations: VariableDeclarator[];
  kind: 'var' | 'let' | 'const';
}

export interface VariableDeclarator extends BaseNode {
  type: 'VariableDeclarator';
  id: Pattern;
  init: Expression | null;
}

export interface BlockStatement extends BaseNode {
  type: 'BlockStatement';
  body: Statement[];
}

export interface ExpressionStatement extends BaseNode {
  type: 'ExpressionStatement';
  expression: Expression;
}

export interface IfStatement extends BaseNode {
  type: 'IfStatement';
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

export interface ReturnStatement extends BaseNode {
  type: 'ReturnStatement';
  argument: Expression | null;
}

export interface MemberExpression extends BaseNode {
  type: 'MemberExpression';
  object: Expression;
  property: Expression;
  computed: boolean;
  optional?: boolean;
}

export interface CallExpression extends BaseNode {
  type: 'CallExpression';
  callee: Expression;
  arguments: Array<Expression | SpreadElement>;
  optional?: boolean;
}

export interface UnaryExpression extends BaseNode {
  type: 'UnaryExpression';
  operator: '-' | '+' | '!' | '~' | 'typeof' | 'void' | 'delete';
  prefix: boolean;
  argument: Expression;
}

export interface BinaryExpression extends BaseNode {
  type: 'BinaryExpression';
  operator:
    | '=='
    | '!='
    | '==='
    | '!=='
    | '<'
    | '<='
    | '>'
    | '>='
    | '<<'
    | '>>'
    | '>>>'
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '**'
    | '|'
    | '^'
    | '&'
    | 'in'
    | 'instanceof';
  left: Expression;
  right: Expression;
}

export interface LogicalExpression extends BaseNode {
  type: 'LogicalExpression';
  operator: '||' | '&&' | '??';
  left: Expression;
  right: Expression;
}

export interface AssignmentExpression extends BaseNode {
  type: 'AssignmentExpression';
  operator: string;
  left: Pattern | MemberExpression;
  right: Expression;
}

export interface ConditionalExpression extends BaseNode {
  type: 'ConditionalExpression';
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface TemplateLiteral extends BaseNode {
  type: 'TemplateLiteral';
  quasis: TemplateElement[];
  expressions: Expression[];
}

export interface TemplateElement extends BaseNode {
  type: 'TemplateElement';
  value: {
    raw: string;
    cooked?: string | null;
  };
  tail: boolean;
}

export interface SequenceExpression extends BaseNode {
  type: 'SequenceExpression';
  expressions: Expression[];
}

export interface ForOfStatement extends BaseNode {
  type: 'ForOfStatement';
  left: VariableDeclaration | Pattern;
  right: Expression;
  body: Statement;
  await: boolean;
}

export interface NewExpression extends BaseNode {
  type: 'NewExpression';
  callee: Expression;
  arguments: Array<Expression | SpreadElement>;
}

export interface EmptyStatement extends BaseNode {
  type: 'EmptyStatement';
}

export interface DebuggerStatement extends BaseNode {
  type: 'DebuggerStatement';
}

export interface WithStatement extends BaseNode {
  type: 'WithStatement';
  object: Expression;
  body: Statement;
}

export interface LabeledStatement extends BaseNode {
  type: 'LabeledStatement';
  label: Identifier;
  body: Statement;
}

export interface BreakStatement extends BaseNode {
  type: 'BreakStatement';
  label: Identifier | null;
}

export interface ContinueStatement extends BaseNode {
  type: 'ContinueStatement';
  label: Identifier | null;
}

export interface SwitchCase extends BaseNode {
  type: 'SwitchCase';
  test: Expression | null;
  consequent: Statement[];
}

export interface SwitchStatement extends BaseNode {
  type: 'SwitchStatement';
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface ThrowStatement extends BaseNode {
  type: 'ThrowStatement';
  argument: Expression;
}

export interface CatchClause extends BaseNode {
  type: 'CatchClause';
  param: Pattern | null;
  body: BlockStatement;
}

export interface TryStatement extends BaseNode {
  type: 'TryStatement';
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
}

export interface WhileStatement extends BaseNode {
  type: 'WhileStatement';
  test: Expression;
  body: Statement;
}

export interface DoWhileStatement extends BaseNode {
  type: 'DoWhileStatement';
  body: Statement;
  test: Expression;
}

export interface ForStatement extends BaseNode {
  type: 'ForStatement';
  init: VariableDeclaration | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
}

export interface ForInStatement extends BaseNode {
  type: 'ForInStatement';
  left: VariableDeclaration | Pattern;
  right: Expression;
  body: Statement;
}

export interface ClassDeclaration extends BaseNode {
  type: 'ClassDeclaration';
  id: Identifier | null;
  superClass: Expression | null;
  body: ClassBody;
}

export interface ClassExpression extends BaseNode {
  type: 'ClassExpression';
  id: Identifier | null;
  superClass: Expression | null;
  body: ClassBody;
}

export interface ClassBody extends BaseNode {
  type: 'ClassBody';
  body: MethodDefinition[];
}

export interface MethodDefinition extends BaseNode {
  type: 'MethodDefinition';
  key: Expression;
  value: FunctionExpression;
  kind: 'constructor' | 'method' | 'get' | 'set';
  computed: boolean;
  static: boolean;
}

export interface YieldExpression extends BaseNode {
  type: 'YieldExpression';
  argument: Expression | null;
  delegate: boolean;
}

export interface AwaitExpression extends BaseNode {
  type: 'AwaitExpression';
  argument: Expression;
}

export interface UpdateExpression extends BaseNode {
  type: 'UpdateExpression';
  operator: '++' | '--';
  argument: Expression;
  prefix: boolean;
}

export interface TaggedTemplateExpression extends BaseNode {
  type: 'TaggedTemplateExpression';
  tag: Expression;
  quasi: TemplateLiteral;
}

export interface MetaProperty extends BaseNode {
  type: 'MetaProperty';
  meta: Identifier;
  property: Identifier;
}

export interface ChainExpression extends BaseNode {
  type: 'ChainExpression';
  expression: CallExpression | MemberExpression;
}

export interface ImportExpression extends BaseNode {
  type: 'ImportExpression';
  source: Expression;
}

// JSX AST Nodes
export interface JSXIdentifier extends BaseNode {
  type: 'JSXIdentifier';
  name: string;
}

export interface JSXMemberExpression extends BaseNode {
  type: 'JSXMemberExpression';
  object: JSXMemberExpression | JSXIdentifier;
  property: JSXIdentifier;
}

export interface JSXNamespacedName extends BaseNode {
  type: 'JSXNamespacedName';
  namespace: JSXIdentifier;
  name: JSXIdentifier;
}

export type JSXTagName = JSXIdentifier | JSXMemberExpression | JSXNamespacedName;

export interface JSXAttribute extends BaseNode {
  type: 'JSXAttribute';
  name: JSXIdentifier | JSXNamespacedName;
  value: Literal | JSXExpressionContainer | JSXElement | JSXFragment | null;
}

export interface JSXSpreadAttribute extends BaseNode {
  type: 'JSXSpreadAttribute';
  argument: Expression;
}

export interface JSXExpressionContainer extends BaseNode {
  type: 'JSXExpressionContainer';
  expression: Expression | JSXEmptyExpression;
}

export interface JSXEmptyExpression extends BaseNode {
  type: 'JSXEmptyExpression';
}

export interface JSXText extends BaseNode {
  type: 'JSXText';
  value: string;
  raw?: string;
}

export interface JSXOpeningElement extends BaseNode {
  type: 'JSXOpeningElement';
  name: JSXTagName;
  attributes: Array<JSXAttribute | JSXSpreadAttribute>;
  selfClosing: boolean;
}

export interface JSXClosingElement extends BaseNode {
  type: 'JSXClosingElement';
  name: JSXTagName;
}

export interface JSXElement extends BaseNode {
  type: 'JSXElement';
  openingElement: JSXOpeningElement;
  closingElement: JSXClosingElement | null;
  children: JSXChild[];
}

export interface JSXOpeningFragment extends BaseNode {
  type: 'JSXOpeningFragment';
}

export interface JSXClosingFragment extends BaseNode {
  type: 'JSXClosingFragment';
}

export interface JSXFragment extends BaseNode {
  type: 'JSXFragment';
  openingFragment: JSXOpeningFragment;
  closingFragment: JSXClosingFragment;
  children: JSXChild[];
}

export type JSXChild =
  | JSXText
  | JSXExpressionContainer
  | JSXSpreadChild
  | JSXElement
  | JSXFragment;

export interface JSXSpreadChild extends BaseNode {
  type: 'JSXSpreadChild';
  expression: Expression;
}

export type Pattern =
  | Identifier
  | ObjectPattern
  | ArrayPattern
  | RestElement
  | AssignmentPattern
  | MemberExpression;

export interface ObjectPattern extends BaseNode {
  type: 'ObjectPattern';
  properties: Array<Property | RestElement>;
  typeAnnotation?: BaseNode | null;
}

export interface ArrayPattern extends BaseNode {
  type: 'ArrayPattern';
  elements: Array<Pattern | null>;
  typeAnnotation?: BaseNode | null;
}

export interface RestElement extends BaseNode {
  type: 'RestElement';
  argument: Pattern;
}

export interface AssignmentPattern extends BaseNode {
  type: 'AssignmentPattern';
  left: Pattern;
  right: Expression;
}

export interface ImportDeclaration extends BaseNode {
  type: 'ImportDeclaration';
  specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
  source: StringLiteral;
  importKind?: 'type' | 'typeof' | 'value' | null;
}

export interface ImportSpecifier extends BaseNode {
  type: 'ImportSpecifier';
  imported: Identifier | StringLiteral;
  local: Identifier;
  importKind?: 'type' | 'typeof' | 'value' | null;
}

export interface ImportDefaultSpecifier extends BaseNode {
  type: 'ImportDefaultSpecifier';
  local: Identifier;
}

export interface ImportNamespaceSpecifier extends BaseNode {
  type: 'ImportNamespaceSpecifier';
  local: Identifier;
}

export interface ExportNamedDeclaration extends BaseNode {
  type: 'ExportNamedDeclaration';
  declaration: Declaration | null;
  specifiers: ExportSpecifier[];
  source: StringLiteral | null;
}

export interface ExportSpecifier extends BaseNode {
  type: 'ExportSpecifier';
  local: Identifier;
  exported: Identifier | StringLiteral;
}

export interface ExportDefaultDeclaration extends BaseNode {
  type: 'ExportDefaultDeclaration';
  declaration: Declaration | Expression;
}

export interface ExportAllDeclaration extends BaseNode {
  type: 'ExportAllDeclaration';
  source: Literal;
  exported: Identifier | null;
}
