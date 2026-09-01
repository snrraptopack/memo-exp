/**
 * components/calls.ts - named JSX props to component factory arguments.
 *
 * Call sites use names while component factories may use positional slots or
 * one object envelope. These builders are shared by static and keyed-row
 * component emission so prop order and spread projection cannot drift.
 */

import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  isValidIdentifier as isValidEstreeIdentifier,
} from '../ast';
import type { Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';

export interface ComponentPropEntry {
  name: string;
  value: t.Expression;
}

export function orderCallProps(
  ctx: Ctx,
  tag: string,
  entries: ComponentPropEntry[],
): t.Expression[] {
  const plan = ctx.componentProps.get(tag);
  if (plan?.mode === 'object') {
    if (!plan.acceptsUnknown) {
      for (const entry of entries) {
        if (!plan.names.includes(entry.name)) {
          throw new Error(
            `memo-dom: unknown prop '${entry.name}' on <${tag}> - declared props: ${
              plan.names.length > 0 ? plan.names.join(', ') : '(none)'
            }`,
          );
        }
      }
    }
    if (entries.length === 0 && plan.hasWholeDefault) {
      return [astFactory.identifier('undefined')];
    }
    return [
      astFactory.objectExpression(
        entries.map((entry) =>
          astFactory.objectProperty(
            astFactory.identifier(entry.name),
            entry.value,
            false,
            astFactory.isIdentifier(entry.value) &&
              entry.value.name === entry.name,
          ),
        ),
      ),
    ];
  }
  const declared = plan?.names;
  if (declared === undefined) return entries.map((entry) => entry.value);
  const byName = new Map(
    entries.map((entry) => [entry.name, entry.value]),
  );
  for (const name of byName.keys()) {
    if (!declared.includes(name)) {
      throw new Error(
        `memo-dom: unknown prop '${name}' on <${tag}> - declared props: ${
          declared.length > 0 ? declared.join(', ') : '(none)'
        }`,
      );
    }
  }
  return declared.map(
    (name) => byName.get(name) ?? astFactory.identifier('undefined'),
  );
}

export function callPropsFromObject(
  ctx: Ctx,
  tag: string,
  object: t.Expression,
): t.Expression[] {
  const plan = ctx.componentProps.get(tag);
  if (plan?.mode === 'object') return [cloneEstreeNode(object)];
  return (plan?.names ?? []).map((name) =>
    astFactory.memberExpression(
      cloneEstreeNode(object),
      isValidEstreeIdentifier(name)
        ? astFactory.identifier(name)
        : astFactory.stringLiteral(name),
      !isValidEstreeIdentifier(name),
    ),
  );
}

export function buildSpreadComponentPropUpdate(
  ctx: Ctx,
  tag: string,
  ownerId: t.Expression,
  idSuffix: string,
  expression: t.ObjectExpression,
): t.Statement {
  const next = generatedIdentifier(ctx, `${tag}Props`);
  return astFactory.blockStatement([
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(next),
        cloneEstreeNode(expression),
      ),
    ]),
    astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'setProps'), [
        astFactory.binaryExpression(
          '+',
          cloneEstreeNode(ownerId),
          astFactory.stringLiteral(idSuffix),
        ),
        astFactory.arrayExpression(callPropsFromObject(ctx, tag, next)),
      ]),
    ),
  ]);
}
