/**
 * Ordered replay for pure component-body calculations.
 *
 * Const derivations and pure if/switch assignments share one source order.
 * Partial controls restore their initializer-backed fallbacks before replay.
 * Dirty reasons guard adjacent calculations with equal dependencies; a
 * reason-less update conservatively runs every calculation.
 */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import { planPreludeReplay } from '../../emission/prelude';
import { instanceSourceReasons } from '../instance-reasons';
import type { DomContext as Ctx } from '../context';
import { type ControlFlowDerivation, type LocalDerivation } from '../../components/props';
import { buildDerivationReplay } from '../derivation-replay';
import { reasonCondition, structuralReasonsFor } from './local-derived';

interface PreludeGroup {
  reasons: (number | string)[] | null;
  statements: t.Statement[];
  includePull: boolean;
}

export function buildRenderPreludeReplay(
  ctx: Ctx,
  component: string,
  reasonVar: string | null,
  body: t.Statement[],
  locals: LocalDerivation[],
  controls: ControlFlowDerivation[],
  pullIndependent: ((expression: t.Expression) => boolean) | null = null,
): t.BlockStatement {
  const steps = planPreludeReplay(
    body,
    locals,
    controls,
    (derivation) => buildDerivationReplay(ctx, derivation),
    pullIndependent,
  );

  const reasonIds = ctx.instanceReasonIds.get(component);
  const groups: PreludeGroup[] = [];
  for (const step of steps) {
    const reasons =
      reasonVar === null || reasonIds === undefined
        ? null
        : step.sources
            .flatMap((source) => instanceSourceReasons(ctx, component, source) ?? [])
            .sort((left, right) => left - right);
    const exact: (number | string)[] | null =
      reasons === null ||
      step.sources.some((source) => instanceSourceReasons(ctx, component, source) === null)
        ? null
        : [...reasons, ...structuralReasonsFor(ctx, step.sources)];
    const key = exact?.join(' ') ?? '*';
    const previous = groups.at(-1);
    const previousKey = previous?.reasons?.join(' ') ?? '*';
    if (
      previous !== undefined &&
      previousKey === key &&
      previous.includePull === step.includePull
    ) {
      previous.statements.push(step.statement);
    } else {
      groups.push({
        reasons: exact,
        statements: [step.statement],
        includePull: step.includePull,
      });
    }
  }

  return astFactory.blockStatement(
    groups.map((group) =>
      group.reasons === null || reasonVar === null
        ? astFactory.blockStatement(group.statements)
        : astFactory.ifStatement(
            reasonCondition(ctx, reasonVar, group.reasons, group.includePull),
            astFactory.blockStatement(group.statements),
          ),
    ),
  );
}
