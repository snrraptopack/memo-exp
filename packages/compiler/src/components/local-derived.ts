/**
 * Emits dependency-selected replay for component-local derivations.
 */
import * as t from '@babel/types';
import type { Ctx } from '../context';
import type { LocalDerivation } from './props';
import { buildDerivationReplay } from './props';

interface ReplayGroup {
  reasons: number[];
  derivations: LocalDerivation[];
}

function or(expressions: t.Expression[]): t.Expression {
  return expressions.reduce((left, right) =>
    t.logicalExpression('||', left, right),
  );
}

export function reasonCondition(
  reasonVar: string,
  reasons: number[],
): t.Expression {
  const current = (): t.Identifier => t.identifier(reasonVar);
  const numberMatch = or(
    reasons.map((reason) =>
      t.binaryExpression('===', current(), t.numericLiteral(reason)),
    ),
  );
  const setMatch = or(
    reasons.map((reason) =>
      t.callExpression(
        t.memberExpression(current(), t.identifier('has')),
        [t.numericLiteral(reason)],
      ),
    ),
  );
  return t.logicalExpression(
    '||',
    t.binaryExpression('===', current(), t.nullLiteral()),
    t.conditionalExpression(
      t.binaryExpression(
        '===',
        t.unaryExpression('typeof', current()),
        t.stringLiteral('number'),
      ),
      numberMatch,
      setMatch,
    ),
  );
}

function replayGroups(
  ctx: Ctx,
  component: string,
  derivations: LocalDerivation[],
): ReplayGroup[] | null {
  const reasonIds = ctx.instanceReasonIds.get(component);
  if (reasonIds === undefined) return null;
  const groups: ReplayGroup[] = [];
  for (const derivation of derivations) {
    const reasons = derivation.sources
      .map((source) => reasonIds.get(source))
      .filter((reason): reason is number => reason !== undefined)
      .sort((a, b) => a - b);
    if (
      reasons.length === 0 ||
      reasons.length !== derivation.sources.length
    ) {
      return null;
    }
    const key = reasons.join(' ');
    const previous = groups.at(-1);
    if (
      previous !== undefined &&
      previous.reasons.join(' ') === key
    ) {
      previous.derivations.push(derivation);
    } else {
      groups.push({ reasons, derivations: [derivation] });
    }
  }
  return groups;
}

/**
 * Falls back to unconditional replay when dependency metadata is incomplete.
 */
export function buildLocalDerivationReplay(
  ctx: Ctx,
  component: string,
  reasonVar: string | null,
  derivations: LocalDerivation[],
): t.BlockStatement {
  if (reasonVar === null) {
    return t.blockStatement(
      derivations.map((derivation) =>
        buildDerivationReplay(derivation),
      ),
    );
  }
  const groups = replayGroups(ctx, component, derivations);
  if (groups === null) {
    return t.blockStatement(
      derivations.map((derivation) =>
        buildDerivationReplay(derivation),
      ),
    );
  }
  return t.blockStatement(
    groups.map((group) =>
      t.ifStatement(
        reasonCondition(reasonVar, group.reasons),
        t.blockStatement(
          group.derivations.map((derivation) =>
            buildDerivationReplay(derivation),
          ),
        ),
      ),
    ),
  );
}
