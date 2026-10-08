/** Facts about completed JavaScript values; operand evaluation remains authored. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {nodeField,unwrapTypeExpression,type BaseNode} from '../ast';

export function expressionProducesPrimitive(expression:t.Expression):boolean {
  const node=unwrapTypeExpression(expression as unknown as BaseNode) as unknown as t.Expression;
  if (node.type==='BinaryExpression' || node.type==='UnaryExpression' || node.type==='TemplateLiteral')return true;
  if (astFactory.isConditionalExpression(node))return expressionProducesPrimitive(node.consequent) && expressionProducesPrimitive(node.alternate);
  if (astFactory.isLogicalExpression(node))return expressionProducesPrimitive(node.left) && expressionProducesPrimitive(node.right);
  if (node.type==='SequenceExpression') {
    const last=node.expressions.at(-1);
    return last!==undefined && expressionProducesPrimitive(last);
  }
  if (nodeField(node as unknown as BaseNode,'regex')!==undefined)return false;
  return astFactory.isStringLiteral(node) || astFactory.isNumericLiteral(node) ||
    astFactory.isBooleanLiteral(node) || astFactory.isNullLiteral(node) ||
    (node.type==='Literal' && (typeof nodeField(node as unknown as BaseNode,'value')==='bigint' ||
      nodeField(node as unknown as BaseNode,'bigint')!==undefined));
}
