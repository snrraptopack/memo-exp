/**
 * Effect invalidation, registration, and module rewrite emission.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  nodeFields as fields,
  walkAst,
  type BaseNode,
} from '../ast';
import {
  refreshAstAnalysis,
  type Ctx,
  type EffectSite,
  type ModuleEffectSite,
  type ProgramPath,
} from '../context';
import { generatedIdentifier, md } from '../identifiers';
import type { EmitScope } from '../emission/scope';
import {
  activeEffectId,
  effectId,
  isIntrinsicEffect,
} from './discovery';

function or(expressions: t.Expression[]): t.Expression {
  return expressions.reduce((left, right) =>
    astFactory.logicalExpression('||', left, right),
  );
}

function localEffectCondition(
  ctx: Ctx,
  component: string,
  reasonVar: string,
  reads: Set<string>,
): t.Expression | null {
  const reasonIds = ctx.instanceReasonIds.get(component);
  if (reasonIds === undefined) return null;
  const reasons = [...reads]
    .map((source) => reasonIds.get(source))
    .filter((reason): reason is number => reason !== undefined)
    .sort((a, b) => a - b);
  if (reasons.length === 0 || reasons.length !== reads.size) {
    return null;
  }
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  const numberMatch = or(
    reasons.map((reason) =>
      astFactory.binaryExpression('===', current(), astFactory.numericLiteral(reason)),
    ),
  );
  const setMatch = or(
    reasons.map((reason) =>
      astFactory.callExpression(
        astFactory.memberExpression(current(), astFactory.identifier('has')),
        [astFactory.numericLiteral(reason)],
      ),
    ),
  );
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), astFactory.nullLiteral()),
    astFactory.conditionalExpression(
      astFactory.binaryExpression(
        '===',
        astFactory.unaryExpression('typeof', current()),
        astFactory.stringLiteral('number'),
      ),
      numberMatch,
      setMatch,
    ),
  );
}

/** A pull-only frame is not evidence that any effect dependency was written. */
function volatilePullOnly(reasonVar: string): t.Expression {
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), astFactory.unaryExpression('-', astFactory.numericLiteral(1))),
    astFactory.logicalExpression(
      '&&',
      astFactory.logicalExpression(
        '&&',
        astFactory.binaryExpression('!==', current(), astFactory.nullLiteral()),
        astFactory.binaryExpression(
          '!==',
          astFactory.unaryExpression('typeof', current()),
          astFactory.stringLiteral('number'),
        ),
      ),
      astFactory.logicalExpression(
        '&&',
        astFactory.binaryExpression(
          '===',
          astFactory.memberExpression(current(), astFactory.identifier('size')),
          astFactory.numericLiteral(1),
        ),
        astFactory.callExpression(
          astFactory.memberExpression(current(), astFactory.identifier('has')),
          [astFactory.unaryExpression('-', astFactory.numericLiteral(1))],
        ),
      ),
    ),
  );
}

/**
 * Dirty local/prop-dependent effect entities after the owner's DOM update.
 */
export function buildLocalEffectInvalidations(
  ctx: Ctx,
  component: string,
  factoryId: string,
  reasonVar: string | null,
  sites: EffectSite[],
  scope?: EmitScope,
): t.Statement {
  const buildMark = (
    site: EffectSite,
    target: t.Expression,
    localReads: Set<string>,
    derivationReads: Set<string>,
    label: string,
  ): t.Statement | null => {
      if (localReads.size === 0 && derivationReads.size === 0) return null;
      let mark: t.Statement = astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'markDirty'), [
          target,
        ]),
      );

      if (derivationReads.size > 0 && scope !== undefined) {
        const checks: t.Expression[] = [];
        const updates: t.Statement[] = [];

        for (const derivName of derivationReads) {
          const slotName = generatedIdentifier(
            ctx,
            `eff${site.index}_${label}_${derivName}`,
          ).name;
          scope.creation.push(
            astFactory.variableDeclaration('let', [
              astFactory.variableDeclarator(
                astFactory.identifier(slotName),
                astFactory.identifier(derivName),
              ),
            ]),
          );
          checks.push(
            astFactory.binaryExpression(
              '!==',
              astFactory.identifier(slotName),
              astFactory.identifier(derivName),
            ),
          );
          updates.push(
            astFactory.expressionStatement(
              astFactory.assignmentExpression(
                '=',
                astFactory.identifier(slotName),
                astFactory.identifier(derivName),
              ),
            ),
          );
        }

        const condition =
          checks.length === 1
            ? checks[0]!
            : checks.reduce((left, right) =>
                astFactory.logicalExpression('||', left, right),
              );

        mark = astFactory.ifStatement(
          condition,
          astFactory.blockStatement([...updates, mark]),
        );
      }

      if (reasonVar === null) return mark;
      const condition = localEffectCondition(
        ctx,
        component,
        reasonVar,
        localReads,
      );
      const routed = condition === null ? mark : astFactory.ifStatement(condition, mark);
      return astFactory.ifStatement(
        astFactory.unaryExpression('!', volatilePullOnly(reasonVar)),
        routed,
      );
  };

  const statements = sites.flatMap((site) => {
    const conditionMark =
      site.condition === null
        ? null
        : buildMark(
            site,
            effectId(factoryId, site.index),
            site.conditionLocalReads,
            site.conditionLocalDerivationReads,
            'condition',
          );
    const callbackMark = buildMark(
      site,
      site.condition === null
        ? effectId(factoryId, site.index)
        : activeEffectId(factoryId, site.index),
      site.localReads,
      site.localDerivationReads,
      'callback',
    );
    return [conditionMark, callbackMark].filter(
      (statement): statement is t.Statement => statement !== null,
    );
  });
  return astFactory.blockStatement(statements);
}

/** Runtime registrations emitted after the owner's DOM creation statements. */
export function buildEffectRegistrations(
  ctx: Ctx,
  factoryId: string,
  sites: EffectSite[],
): t.Statement[] {
  return sites.map((site) =>
    astFactory.expressionStatement(
      astFactory.callExpression(
        md(
          ctx,
          site.condition === null
            ? 'registerEffect'
            : 'registerConditionalEffect',
        ),
        [
          effectId(factoryId, site.index),
          astFactory.identifier(factoryId),
          ...(site.condition === null
            ? []
            : [
                astFactory.arrowFunctionExpression(
                  [],
                  cloneEstreeNode(site.condition, true),
                ),
              ]),
          cloneEstreeNode(site.callback, true),
        ],
      ),
    ),
  );
}

function importMetaHot(): t.MemberExpression {
  return astFactory.memberExpression(
    astFactory.metaProperty(astFactory.identifier('import'), astFactory.identifier('meta')),
    astFactory.identifier('hot'),
  );
}

/** Lower direct module effects to stable singleton registrations. */
export function rewriteModuleEffects(
  ctx: Ctx,
  programPath: ProgramPath,
): void {
  if (ctx.moduleEffects.length === 0) return;
  const grouped = new Map<t.Statement, ModuleEffectSite[]>();
  for (const site of ctx.moduleEffects) {
    const sites = grouped.get(site.statement) ?? [];
    sites.push(site);
    grouped.set(site.statement, sites);
  }
  for (const [statement, sites] of grouped) {
    const body = fields(programPath.node).body as t.Statement[];
    const index = body.indexOf(statement);
    if (index === -1) continue;
    const replacements: t.Statement[] = [];
    for (const site of sites) {
      replacements.push(
        astFactory.expressionStatement(
          astFactory.callExpression(
            md(
              ctx,
              site.condition === null
                ? 'registerEffect'
                : 'registerConditionalEffect',
            ),
            [
              astFactory.stringLiteral(site.entityId),
              astFactory.nullLiteral(),
              ...(site.condition === null
                ? []
                : [
                    astFactory.arrowFunctionExpression(
                      [],
                      cloneEstreeNode(site.condition, true),
                    ),
                  ]),
              cloneEstreeNode(site.callback, true),
            ],
          ),
        ),
        astFactory.ifStatement(
          importMetaHot(),
          astFactory.expressionStatement(
            astFactory.callExpression(
              astFactory.memberExpression(importMetaHot(), astFactory.identifier('dispose')),
              [
                astFactory.arrowFunctionExpression(
                  [],
                  astFactory.callExpression(md(ctx, 'unregisterSubtree'), [
                    astFactory.stringLiteral(site.entityId),
                  ]),
                ),
              ],
            ),
          ),
        ),
      );
    }
    body.splice(index, 1, ...replacements);
  }
}

/** Reject effect syntax that was not consumed by component emission. */
export function rejectUnownedEffects(
  ctx: Ctx,
  programPath: ProgramPath,
): void {
  refreshAstAnalysis(ctx, programPath.node);
  walkAst(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type === 'CallExpression' && isIntrinsicEffect(ctx, node)) {
        throw programPath.buildCodeFrameError(
          'memo-dom: effect() must be a direct top-level statement or be controlled by a top-level effect-only if branch in a component or module',
        );
      }
    },
  });
}
