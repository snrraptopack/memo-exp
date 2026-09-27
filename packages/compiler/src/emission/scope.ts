/**
 * emission/scope.ts - generated bindings and statements shared by emitters.
 *
 * Owns per-factory slots, updater declarations, guarded writes, and entity
 * registration so emit.ts can focus on component and JSX structure.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
import { reasonCondition } from '../components/local-derived';

export interface EmitScope {
  slots: string[];
  tempVar: string;
  updateVar: string;
  /** Optional dependency reasons accepted by the owner updater. */
  reasonVar: string | null;
  /** Exact reason ids for a slot expression, or null when it must always run. */
  slotReasons: ((expression: t.Expression) => (number | string)[] | null) | null;
  /** Reasons that gate an updater; absent entries run on every update. */
  updaterReasons: Map<() => t.Statement, (number | string)[]>;
  /** Event name to compiler-private prebound list/event binding. */
  delegatedEventBindings: Map<string, string>;
  /** Active renderer document, resolved once when this factory creates DOM. */
  documentVar: string | null;
  /** Factory-local setup emitted before authored and creation statements. */
  prelude: t.Statement[];
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
  /** Stable source-order identities for exact transparent-data sinks. */
  dataSiteCounter: { count: number };
  /** Source routes already owned by an enclosing transparent region. */
  coveredTransparentSources: Set<string>;
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
    slotReasons: null,
    updaterReasons: new Map(),
    delegatedEventBindings: new Map(),
    documentVar: null,
    prelude: [],
    creation: [],
    mounts: [],
    updaters: [],
    tagCounters: new Map(),
    childCounts: new Map(),
    usedPrefixes: new Map(),
    usedConds: { count: 0 },
    textCounter: 0,
    regionCounter: 0,
    dataSiteCounter: { count: 0 },
    coveredTransparentSources: new Set(),
    disposableRegions: [],
    disposableEntities: [],
    disposableCallbacks: [],
    forwardedSlotCounter: 0,
    manualDisposal,
  };
}

/** Resolve the active renderer document once per DOM-producing factory. */
export function renderDocument(ctx: Ctx, scope: EmitScope): t.Identifier {
  if (scope.documentVar === null) {
    scope.documentVar = generatedIdentifier(ctx, 'document').name;
    scope.prelude.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(scope.documentVar),
          astFactory.memberExpression(
            astFactory.callExpression(md(ctx, 'getActiveEnvironment'), []),
            astFactory.identifier('document'),
          ),
        ),
      ]),
    );
  }
  return astFactory.identifier(scope.documentVar);
}

export function cacheDecl(scope: EmitScope): t.Statement {
  return astFactory.variableDeclaration('let', [
    ...scope.slots.map((name) => astFactory.variableDeclarator(astFactory.identifier(name))),
    astFactory.variableDeclarator(astFactory.identifier(scope.tempVar)),
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
  const value = (): t.Identifier => astFactory.identifier(scope.tempVar);
  const slotId = (): t.Identifier => astFactory.identifier(slot);
  return astFactory.ifStatement(
    astFactory.binaryExpression(
      '!==',
      slotId(),
      astFactory.assignmentExpression('=', value(), expression),
    ),
    astFactory.blockStatement([
      astFactory.expressionStatement(astFactory.assignmentExpression('=', slotId(), value())),
      write(value()),
    ]),
  );
}

/** Queue a slot updater, gated by the expression's exact reasons when known. */
export function pushSlotUpdater(
  scope: EmitScope,
  updater: () => t.Statement,
  expression: t.Expression,
): void {
  const reasons = scope.slotReasons?.(expression) ?? null;
  if (reasons !== null && reasons.length > 0) {
    scope.updaterReasons.set(updater, reasons);
  }
  scope.updaters.push(updater);
}

/**
 * Adjacent updaters with equal reasons share one `if` so a partial update
 * skips whole runs of slots; ungated updaters run unconditionally.
 */
function updateBody(ctx: Ctx, scope: EmitScope): t.Statement[] {
  if (scope.reasonVar === null || scope.updaterReasons.size === 0) {
    return scope.updaters.map((updater) => updater());
  }
  const body: t.Statement[] = [];
  let group: {
    key: string;
    reasons: (number | string)[];
    statements: t.Statement[];
  } | null = null;
  const flush = (): void => {
    if (group !== null) {
      body.push(
        astFactory.ifStatement(
          reasonCondition(ctx, scope.reasonVar!, group.reasons),
          astFactory.blockStatement(group.statements),
        ),
      );
      group = null;
    }
  };
  for (const updater of scope.updaters) {
    const reasons = scope.updaterReasons.get(updater);
    if (reasons === undefined) {
      flush();
      body.push(updater());
      continue;
    }
    const key = reasons.join(' ');
    if (group === null || group.key !== key) {
      flush();
      group = { key, reasons, statements: [] };
    }
    group.statements.push(updater());
  }
  flush();
  return body;
}

export function updateDecl(ctx: Ctx, scope: EmitScope): t.Statement {
  return astFactory.variableDeclaration('const', [
    astFactory.variableDeclarator(
      astFactory.identifier(scope.updateVar),
      astFactory.arrowFunctionExpression(
        scope.reasonVar === null
          ? []
          : [
              astFactory.assignmentPattern(
                astFactory.identifier(scope.reasonVar),
                astFactory.nullLiteral(),
              ),
            ],
        astFactory.blockStatement(updateBody(ctx, scope)),
      ),
    ),
  ]);
}

export function registerStmt(
  ctx: Ctx,
  id: t.Expression,
  parent: t.Expression,
  render: t.Expression,
  volatile = false,
): t.Statement {
  return astFactory.expressionStatement(
    astFactory.callExpression(md(ctx, 'register'), [
      astFactory.objectExpression([
        astFactory.objectProperty(astFactory.identifier('id'), id),
        astFactory.objectProperty(astFactory.identifier('parent'), parent),
        astFactory.objectProperty(astFactory.identifier('render'), render),
        ...(volatile
          ? [astFactory.objectProperty(astFactory.identifier('volatile'), astFactory.booleanLiteral(true))]
          : []),
      ]),
    ]),
  );
}
