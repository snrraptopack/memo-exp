/**
 * components/calls.ts - named JSX props to component factory arguments.
 *
 * Shared prop ordering lives in components/call-props.ts. This module keeps the
 * DOM-only spread update builder and re-exports the neutral call helpers for
 * existing DOM emitter imports.
 */

import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import { cloneNode as cloneEstreeNode } from '../../ast';
import type { DomContext as Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
import {
  callPropsFromObject,
} from '../../components/call-props';

export {
  callPropsFromObject,
  orderCallProps,
  type ComponentPropEntry,
} from '../../components/call-props';

export function buildSpreadComponentPropUpdate(
  ctx: Ctx,
  tag: string,
  ownerId: t.Expression,
  idSuffix: string,
  expression: t.Expression,
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
