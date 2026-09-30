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
  dependencies: Array<{
    dependency: TargetedListDependency;
    cache: string;
  }>,
  mutation: KeyedListMutationPlan | undefined,
  generalReplay: t.Statement,
): t.Statement {
  const ownerReasons = ctx.instanceReasonIds.get(componentName);
  if (ownerReasons === undefined) return generalReplay;
  const source = mutation?.source ?? dependencies[0]?.dependency.source;
  const sourceReason =
    source === undefined ? undefined : ownerReasons.get(source);

  const fullBody: t.Statement[] = [
    generalReplay,
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
  const safeReasons = dependencies.flatMap(({ dependency }) => {
    const reason = ownerReasons.get(dependency.value);
    return reason === undefined ? [] : [reason];
  });
  if (mutation !== undefined) {
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (targetedReason !== undefined) safeReasons.push(targetedReason);
    if (sourceReason !== undefined) safeReasons.push(sourceReason);
  }
  // Module writes use string causes. Unknown owner causes, mixed module/local
  // batches and full updates must replay the general path rather than silently
  // treating absence of the collection's numeric cause as a selection update.
  let fullCondition: t.Expression = astFactory.unaryExpression(
    '!',
    astFactory.callExpression(md(ctx, 'reasonsOnly'), [
      astFactory.identifier(reasonVar),
      astFactory.arrayExpression(
        [...new Set(safeReasons)]
          .sort((a, b) => a - b)
          .map(reason => astFactory.numericLiteral(reason)),
      ),
    ]),
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
    if (sourceReason !== undefined) fullCondition = astFactory.logicalExpression(
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
  }
  const generalUpdate = astFactory.ifStatement(
    fullCondition,
    astFactory.blockStatement(fullBody),
    targetedBody.length === 0 ? undefined : astFactory.blockStatement(targetedBody),
  );
  return generalUpdate;
}
