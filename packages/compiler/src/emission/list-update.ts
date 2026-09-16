/** Targeted and structural update planning for keyed list regions. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  type Ctx,
  type KeyedListMutationPlan,
  type TargetedListDependency,
} from '../context';
import { generatedIdentifier, md } from '../identifiers';

export function runtimeListSource(
  source: t.Expression,
  optional: boolean,
): t.Expression {
  const value = cloneEstreeNode(source);
  return optional
    ? astFactory.logicalExpression('??', value, astFactory.arrayExpression([]))
    : value;
}

function hasReason(reasonVar: string, reason: number): t.Expression {
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  const reasonNode = (): t.Expression =>
    reason < 0
      ? astFactory.unaryExpression('-', astFactory.numericLiteral(-reason), true)
      : astFactory.numericLiteral(reason);
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), reasonNode()),
    astFactory.logicalExpression(
      '&&',
      astFactory.binaryExpression('!==', current(), astFactory.nullLiteral()),
      astFactory.logicalExpression(
        '&&',
        astFactory.binaryExpression(
          '===',
          astFactory.unaryExpression('typeof', current()),
          astFactory.stringLiteral('object'),
        ),
        astFactory.callExpression(
          astFactory.memberExpression(current(), astFactory.identifier('has')),
          [reasonNode()],
        ),
      ),
    ),
  );
}

function refreshKey(
  regionVariable: string,
  value: t.Expression,
): t.Statement {
  return astFactory.expressionStatement(
    astFactory.callExpression(
      astFactory.memberExpression(
        astFactory.identifier(regionVariable),
        astFactory.identifier('refreshKey'),
      ),
      [value],
    ),
  );
}

export function buildTargetedListUpdate(
  ctx: Ctx,
  componentName: string,
  reasonVar: string,
  regionVariable: string,
  sourceExpr: t.Expression,
  optional: boolean,
  dependencies: Array<{
    dependency: TargetedListDependency;
    cache: string;
  }>,
  mutation: KeyedListMutationPlan | undefined,
  structuralSource: string,
): t.Statement {
  const ownerReasons = ctx.instanceReasonIds.get(componentName);
  if (ownerReasons === undefined) {
    return astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(sourceExpr, optional),
          astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
            astFactory.identifier(reasonVar),
            astFactory.stringLiteral(structuralSource),
          ]),
        ],
      ),
    );
  }
  const source = mutation?.source ?? dependencies[0]?.dependency.source;
  const sourceReason =
    source === undefined ? undefined : ownerReasons.get(source);
  if (sourceReason === undefined) {
    return astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(sourceExpr, optional),
          astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
            astFactory.identifier(reasonVar),
            astFactory.stringLiteral(structuralSource),
          ]),
        ],
      ),
    );
  }

  const fullBody: t.Statement[] = [
    astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(sourceExpr, optional),
          astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
            astFactory.identifier(reasonVar),
            astFactory.stringLiteral(structuralSource),
          ]),
        ],
      ),
    ),
    ...dependencies.map(({ dependency, cache }) =>
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.identifier(cache),
          astFactory.identifier(dependency.value),
        ),
      ),
    ),
    ...(mutation === undefined
      ? []
      : [
          astFactory.expressionStatement(
            astFactory.callExpression(
              astFactory.memberExpression(
                astFactory.identifier(mutation.keysVariable),
                astFactory.identifier('clear'),
              ),
              [],
            ),
          ),
        ]),
  ];
  const targetedBody: t.Statement[] = [];
  if (mutation !== undefined) {
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (targetedReason !== undefined) {
      const key = generatedIdentifier(ctx, 'changedListKey');
      targetedBody.push(
        astFactory.ifStatement(
          hasReason(reasonVar, targetedReason),
          astFactory.blockStatement([
            astFactory.forOfStatement(
              astFactory.variableDeclaration('const', [
                astFactory.variableDeclarator(cloneEstreeNode(key)),
              ]),
              astFactory.identifier(mutation.keysVariable),
              astFactory.blockStatement([
                refreshKey(regionVariable, cloneEstreeNode(key)),
              ]),
            ),
            astFactory.expressionStatement(
              astFactory.callExpression(
                astFactory.memberExpression(
                  astFactory.identifier(mutation.keysVariable),
                  astFactory.identifier('clear'),
                ),
                [],
              ),
            ),
          ]),
        ),
      );
    }
  }
  for (const { dependency, cache } of dependencies) {
    const dependencyReason = ownerReasons.get(dependency.value);
    if (dependencyReason === undefined) continue;
    const previous = generatedIdentifier(ctx, 'previousListKey');
    targetedBody.push(
      astFactory.ifStatement(
        hasReason(reasonVar, dependencyReason),
        astFactory.blockStatement([
          astFactory.variableDeclaration('const', [
            astFactory.variableDeclarator(previous, astFactory.identifier(cache)),
          ]),
          astFactory.expressionStatement(
            astFactory.assignmentExpression(
              '=',
              astFactory.identifier(cache),
              astFactory.identifier(dependency.value),
            ),
          ),
          refreshKey(regionVariable, cloneEstreeNode(previous)),
          astFactory.ifStatement(
            astFactory.unaryExpression(
              '!',
              astFactory.callExpression(
                astFactory.memberExpression(
                  astFactory.identifier('Object'),
                  astFactory.identifier('is'),
                ),
                [cloneEstreeNode(previous), astFactory.identifier(cache)],
              ),
            ),
            refreshKey(regionVariable, astFactory.identifier(cache)),
          ),
        ]),
      ),
    );
  }
  let fullCondition: t.Expression = astFactory.binaryExpression(
    '===',
    astFactory.identifier(reasonVar),
    astFactory.nullLiteral(),
  );
  fullCondition = astFactory.logicalExpression(
    '||',
    fullCondition,
    hasReason(reasonVar, -1),
  );
  if (mutation !== undefined) {
    const structuralReason = ownerReasons.get(mutation.structuralReason);
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (structuralReason !== undefined) {
      fullCondition = astFactory.logicalExpression(
        '||',
        fullCondition,
        hasReason(reasonVar, structuralReason),
      );
    }
    fullCondition = astFactory.logicalExpression(
      '||',
      fullCondition,
      targetedReason === undefined
        ? hasReason(reasonVar, sourceReason)
        : astFactory.logicalExpression(
            '&&',
            hasReason(reasonVar, sourceReason),
            astFactory.unaryExpression('!', hasReason(reasonVar, targetedReason)),
          ),
    );
  } else {
    fullCondition = astFactory.logicalExpression(
      '||',
      fullCondition,
      hasReason(reasonVar, sourceReason),
    );
  }
  const generalUpdate = astFactory.ifStatement(
    fullCondition,
    astFactory.blockStatement(fullBody),
    targetedBody.length === 0 ? undefined : astFactory.blockStatement(targetedBody),
  );
  return generalUpdate;
}
