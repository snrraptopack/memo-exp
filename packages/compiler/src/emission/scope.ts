/**
 * emission/scope.ts - generated bindings and statements shared by emitters.
 *
 * Owns per-factory slots, updater declarations, guarded writes, and entity
 * registration so emit.ts can focus on component and JSX structure.
 */

import * as t from '@babel/types';
import type { Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';

export interface EmitScope {
  slots: string[];
  tempVar: string;
  updateVar: string;
  /** Optional dependency reasons accepted by the owner updater. */
  reasonVar: string | null;
  /** Caller-owned root used for repeated-row delegated host events. */
  delegatedEventRootVar: string | null;
  creation: t.Statement[];
  /** Lifecycle setup that runs only after this scope's full DOM is created. */
  mounts: t.Statement[];
  updaters: Array<() => t.Statement>;
  tagCounters: Map<string, number>;
  childCounts: Map<string, number>;
  usedPrefixes: Map<string, number>;
  usedConds: { count: number };
  textCounter: number;
  regionCounter: number;
  /** Structural regions whose retained entries drain with this scope. */
  disposableRegions: string[];
  /** Component entity ids created lexically inside this scope. */
  disposableEntities: t.Expression[];
  /** Lazy content-slot mounts disposed when this structural scope swaps. */
  disposableCallbacks: t.Identifier[];
  /** Source-order identity for forwarded slot mounts in this scope. */
  forwardedSlotCounter: number;
  /** Branch/slot scopes drain callbacks directly instead of by entity owner. */
  manualDisposal: boolean;
}

export function newEmitScope(ctx: Ctx, manualDisposal = false): EmitScope {
  return {
    slots: [],
    tempVar: generatedIdentifier(ctx, 'value').name,
    updateVar: generatedIdentifier(ctx, 'update').name,
    reasonVar: null,
    delegatedEventRootVar: null,
    creation: [],
    mounts: [],
    updaters: [],
    tagCounters: new Map(),
    childCounts: new Map(),
    usedPrefixes: new Map(),
    usedConds: { count: 0 },
    textCounter: 0,
    regionCounter: 0,
    disposableRegions: [],
    disposableEntities: [],
    disposableCallbacks: [],
    forwardedSlotCounter: 0,
    manualDisposal,
  };
}

export function cacheDecl(scope: EmitScope): t.Statement {
  return t.variableDeclaration('let', [
    ...scope.slots.map((name) => t.variableDeclarator(t.identifier(name))),
    t.variableDeclarator(t.identifier(scope.tempVar)),
  ]);
}

export function freshSlot(ctx: Ctx, scope: EmitScope): string {
  const name = generatedIdentifier(ctx, `slot${scope.slots.length}`).name;
  scope.slots.push(name);
  return name;
}

export function freshNodeName(
  ctx: Ctx,
  scope: EmitScope,
  tag: string,
): string {
  const count = scope.tagCounters.get(tag) ?? 0;
  scope.tagCounters.set(tag, count + 1);
  return generatedIdentifier(ctx, `${tag}${count}`).name;
}

export function slotGuard(
  scope: EmitScope,
  slot: string,
  expression: t.Expression,
  write: (value: t.Identifier) => t.Statement,
): t.Statement {
  const value = (): t.Identifier => t.identifier(scope.tempVar);
  const slotId = (): t.Identifier => t.identifier(slot);
  return t.ifStatement(
    t.binaryExpression(
      '!==',
      slotId(),
      t.assignmentExpression('=', value(), expression),
    ),
    t.blockStatement([
      t.expressionStatement(t.assignmentExpression('=', slotId(), value())),
      write(value()),
    ]),
  );
}

export function updateDecl(scope: EmitScope): t.Statement {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(scope.updateVar),
      t.arrowFunctionExpression(
        scope.reasonVar === null
          ? []
          : [
              t.assignmentPattern(
                t.identifier(scope.reasonVar),
                t.nullLiteral(),
              ),
            ],
        t.blockStatement(scope.updaters.map((updater) => updater())),
      ),
    ),
  ]);
}

export function registerStmt(
  ctx: Ctx,
  id: t.Expression,
  parent: t.Expression,
  render: t.Expression,
): t.Statement {
  return t.expressionStatement(
    t.callExpression(md(ctx, 'register'), [
      t.objectExpression([
        t.objectProperty(t.identifier('id'), id),
        t.objectProperty(t.identifier('parent'), parent),
        t.objectProperty(t.identifier('render'), render),
      ]),
    ]),
  );
}
