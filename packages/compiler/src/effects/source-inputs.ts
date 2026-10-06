/** Clone-preserved lexical inputs of compiler-owned source rebinding effects. */
import type * as t from '../ast/compiler-types';
import {nodeField, type BaseNode} from '../ast';

const SOURCE_INPUTS = '__memoDomSourceEffectInputs';
const SOURCE_REPLAY = '__memoDomSourceReplayConsumption';

/** Replay consumes inputs; callbacks it installs retain their own write scope. */
export function sourceReplayConsumption<T extends t.Expression>(expression: T): T {
  if (expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression') {
    Object.assign(expression, {[SOURCE_REPLAY]: true});
  }
  return expression;
}

export function isSourceReplayConsumption(node: BaseNode): boolean {
  return nodeField(node, SOURCE_REPLAY) === true;
}

export function carrySourceEffectInputs(call: t.CallExpression, names: readonly string[]): void {
  Object.assign(call, {[SOURCE_INPUTS]: [...names]});
}

export function sourceEffectInputs(call: BaseNode): readonly string[] {
  return (nodeField(call, SOURCE_INPUTS) as readonly string[] | undefined) ?? [];
}
