/** Ordered semantic replay shared by rendering targets. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { LocalDerivation, ControlFlowDerivation } from '../components/props';
export interface PreludeStep {
  order: number;
  sequence: number;
  sources: string[];
  statement: t.Statement;
  includePull: boolean;
}
export function planPreludeReplay(
  body: readonly t.Statement[],
  locals: readonly LocalDerivation[],
  controls: readonly ControlFlowDerivation[],
  replay: (derivation: LocalDerivation) => t.Statement,
  pullIndependent: ((expression: t.Expression) => boolean) | null = null,
): PreludeStep[] {
  const order = new Map(body.map((statement, index) => [statement, index]));
  let sequence = 0;
  return [
    ...locals.map((derivation) => ({
      order: order.get(derivation.declaration) ?? Number.MAX_SAFE_INTEGER,
      sequence: sequence++,
      sources: derivation.sources,
      statement: replay(derivation),
      // Destructuring and custom replays can execute observable operations.
      // Only ordinary primitive assignments share the DOM slot proof.
      includePull:
        derivation.target.type !== 'Identifier' ||
        derivation.replay !== undefined ||
        derivation.stableTarget === true ||
        pullIndependent?.(derivation.source) !== true ||
        // A primitive intermediate may be assigned by control flow whose
        // condition reads opaque data. Its transitive roots must be proven too.
        derivation.sources.some(
          (source) => pullIndependent?.(astFactory.identifier(source)) !== true,
        ),
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
  ].sort((left, right) => left.order - right.order || left.sequence - right.sequence);
}
