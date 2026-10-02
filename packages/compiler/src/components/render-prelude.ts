/**
 * Ordered replay for pure component-body calculations.
 *
 * Const derivations and pure if/switch assignments share one source order.
 * Partial controls restore their initializer-backed fallbacks before replay.
 * Dirty reasons guard adjacent calculations with equal dependencies; a
 * reason-less update conservatively runs every calculation.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { Ctx } from '../context';
import {
  buildDerivationReplay,
  type ControlFlowDerivation,
  type LocalDerivation,
} from './props';
import { reasonCondition, structuralReasonsFor } from './local-derived';

interface PreludeStep {
  order: number;
  sequence: number;
  sources: string[];
  statement: t.Statement;
  includePull: boolean;
}

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
  const order = new Map(body.map((statement, index) => [statement, index]));
  let sequence = 0;
  const steps: PreludeStep[] = [
    ...locals.map((derivation) => ({
      order: order.get(derivation.declaration) ?? Number.MAX_SAFE_INTEGER,
      sequence: sequence++,
      sources: derivation.sources,
      statement: buildDerivationReplay(derivation),
      // Destructuring and custom replays can execute observable operations.
      // Only ordinary primitive assignments share the DOM slot proof.
      includePull: derivation.target.type !== 'Identifier' ||
        derivation.replay !== undefined || derivation.stableTarget === true ||
        pullIndependent?.(derivation.source) !== true ||
        // A primitive intermediate may be assigned by control flow whose
        // condition reads opaque data. Its transitive roots must be proven too.
        derivation.sources.some(source => pullIndependent?.(astFactory.identifier(source)) !== true),
    })),
    ...controls.map((control) => ({
      order: order.get(control.statement) ?? Number.MAX_SAFE_INTEGER,
      sequence: sequence++,
      sources: control.sources,
      includePull: true,
      statement: astFactory.blockStatement([
        ...control.resets.map((reset) =>
          astFactory.expressionStatement(
            astFactory.assignmentExpression(
              '=',
              astFactory.identifier(reset.binding),
              cloneEstreeNode(reset.source, true),
            ),
          ),
        ),
        cloneEstreeNode(control.statement, true),
      ]),
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
    const exact: (number | string)[] | null =
      reasons === null || reasons.length !== step.sources.length
        ? null
        : [...reasons, ...structuralReasonsFor(ctx, step.sources)];
    const key = exact?.join(' ') ?? '*';
    const previous = groups.at(-1);
    const previousKey = previous?.reasons?.join(' ') ?? '*';
    if (previous !== undefined && previousKey === key && previous.includePull === step.includePull) {
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
