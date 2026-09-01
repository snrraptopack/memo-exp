import type { BaseNode } from '../types';

export interface JSXCodeBlock extends BaseNode {
  type: 'JSXCodeBlock';
  body: BaseNode[];
  render: BaseNode | null;
}

export interface JSXIfExpression extends BaseNode {
  type: 'JSXIfExpression';
  statementType: 'IfStatement';
  test: BaseNode;
  consequent: BaseNode;
  alternate: BaseNode | null;
}

export interface JSXForExpression extends BaseNode {
  type: 'JSXForExpression';
  statementType: 'ForStatement' | 'ForInStatement' | 'ForOfStatement';
  body: BaseNode;
  init?: BaseNode | null;
  test?: BaseNode | null;
  update?: BaseNode | null;
  left?: BaseNode;
  right?: BaseNode;
  await?: boolean;
  index?: BaseNode | null;
  key?: BaseNode | null;
  empty?: BaseNode | null;
}

export interface JSXSwitchExpression extends BaseNode {
  type: 'JSXSwitchExpression';
  statementType: 'SwitchStatement';
  discriminant: BaseNode;
  cases: BaseNode[];
}

export interface JSXTryExpression extends BaseNode {
  type: 'JSXTryExpression';
  statementType: 'TryStatement';
  block: BaseNode;
  handler: BaseNode | null;
  finalizer: BaseNode | null;
  pending?: BaseNode | null;
}

export interface JSXStyleElement extends BaseNode {
  type: 'JSXStyleElement';
  openingElement: BaseNode;
  closingElement: BaseNode | null;
  children: BaseNode[];
  css?: string;
}

export type TsrxExtensionNode =
  | JSXCodeBlock
  | JSXIfExpression
  | JSXForExpression
  | JSXSwitchExpression
  | JSXTryExpression
  | JSXStyleElement;
