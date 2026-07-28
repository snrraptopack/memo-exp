/**
 * Ordered replay for pure component-body calculations.
 *
 * Const derivations and exhaustive if/switch assignments share one source
 * order. Dirty reasons guard adjacent calculations with equal dependencies;
 * a reason-less update conservatively runs every calculation.
 */
import * as t from '@babel/types';
import type { Ctx } from '../context';
import {
  buildDerivationReplay,
  type ControlFlowDerivation,
  type LocalDerivation,
} from './props';
import { reasonCondition } from './local-derived';

interface PreludeStep {
  order: number;
  sequence: number;
  sources: string[];
  statement: t.Statement;
}

interface PreludeGroup {
  reasons: number[] | null;
  statements: t.Statement[];
}

export function buildRenderPreludeReplay(
  ctx: Ctx,
  component: string,
  reasonVar: string | null,
  body: t.Statement[],
  locals: LocalDerivation[],
  controls: ControlFlowDerivation[],
): t.BlockStatement {
  const order = new Map(body.map((statement, index) => [statement, index]));
  let sequence = 0;
  const steps: PreludeStep[] = [
    ...locals.map((derivation) => ({
      order: order.get(derivation.declaration) ?? Number.MAX_SAFE_INTEGER,
      sequence: sequence++,
      sources: derivation.sources,
      statement: buildDerivationReplay(derivation),
    })),
    ...controls.map((control) => ({
      order: order.get(control.statement) ?? Number.MAX_SAFE_INTEGER,
      sequence: sequence++,
      sources: control.sources,
      statement: t.cloneNode(control.statement, true),
    })),
  ].sort(
    (left, right) =>
      left.order - right.order || left.sequence - right.sequence,
  );

  const reasonIds = ctx.instanceReasonIds.get(component);
  const groups: PreludeGroup[] = [];
  for (const step of steps) {
    const reasons =
      reasonVar === null || reasonIds === undefined
        ? null
        : step.sources
            .map((source) => reasonIds.get(source))
            .filter((reason): reason is number => reason !== undefined)
            .sort((left, right) => left - right);
    const exact =
      reasons === null || reasons.length === step.sources.length
        ? reasons
        : null;
    const key = exact?.join(' ') ?? '*';
    const previous = groups.at(-1);
    const previousKey = previous?.reasons?.join(' ') ?? '*';
    if (previous !== undefined && previousKey === key) {
      previous.statements.push(step.statement);
    } else {
      groups.push({
        reasons: exact,
        statements: [step.statement],
      });
    }
  }

  return t.blockStatement(
    groups.map((group) =>
      group.reasons === null || reasonVar === null
        ? t.blockStatement(group.statements)
        : t.ifStatement(
            reasonCondition(reasonVar, group.reasons),
            t.blockStatement(group.statements),
          ),
    ),
  );
}
