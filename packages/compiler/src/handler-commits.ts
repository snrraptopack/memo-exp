/**
 * handler-commits.ts - write-scope commit construction and insertion.
 *
 * Converts analyzed scope effects into local, routed, or unbounded
 * invalidation statements and inserts them after normal completion.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { ESTREE_VISITOR_KEYS } from './ast';
import {
  freshReasonConst,
  freshWriteConst,
  type Ctx,
  type RowCtx,
} from './context';
import {
  componentId,
  generatedIdentifier,
  md,
  mdd,
} from './identifiers';

export interface ScopeWrites {
  writes: Set<string>;
  /** Writes proven to affect a rendered collection's structure only. */
  structuralWrites: Set<string>;
  /** Writes whose effect on retained row content is not structurally bounded. */
  contentWrites: Set<string>;
  rootFallback: boolean;
  /** This scope writes fields observed by one keyed row. */
  rowLocal: boolean;
  /** This scope may affect the instance-owned collection backing the row. */
  rowOwnerLocal: boolean;
  /** This scope writes state owned by one component instance. */
  instanceLocal: boolean;
  /** Exact instance or prop roots written by this scope. */
  instanceWrites: Set<string>;
  /** Component-local colorless payloads mutated in place by authored code. */
  transparentWrites: Set<string>;
  /** Scoped event fallback when a handler has no recognized write. */
  eventOrigin: t.Statement | null;
}

export function createScopeWrites(): ScopeWrites {
  return {
    writes: new Set(),
    structuralWrites: new Set(),
    contentWrites: new Set(),
    rootFallback: false,
    rowLocal: false,
    rowOwnerLocal: false,
    instanceLocal: false,
    instanceWrites: new Set(),
    transparentWrites: new Set(),
    eventOrigin: null,
  };
}

export function recordRoutedWrite(
  scope: ScopeWrites,
  source: string,
  structural = false,
): void {
  scope.writes.add(source);
  (structural ? scope.structuralWrites : scope.contentWrites).add(source);
}

/** Record an exact write to state owned by one component instance. */
export function recordInstanceWrite(
  scope: ScopeWrites,
  source: string,
): void {
  scope.instanceLocal = true;
  scope.instanceWrites.add(source);
}

/** Build the static commit form for one analyzed function scope. */
export function buildScopeCommit(
  ctx: Ctx,
  scope: ScopeWrites,
  compName: string | null,
  rowCtx?: RowCtx,
): t.Statement | null {
  const rowCommit =
    scope.rowLocal && rowCtx !== undefined
      ? astFactory.expressionStatement(
          rowCtx.refreshVar !== undefined
            ? astFactory.callExpression(astFactory.identifier(rowCtx.refreshVar), [])
            : astFactory.callExpression(md(ctx, 'markDirty'), [
                astFactory.identifier(rowCtx.rowIdVar),
              ]),
        )
      : null;
  let instanceCommit: t.Statement | null = null;
  if (scope.instanceLocal && compName !== null) {
    const reasonIds = ctx.instanceReasonIds.get(compName);
    const reasons = [...scope.instanceWrites]
      .map((source) => reasonIds?.get(source))
      .filter((reason): reason is number => reason !== undefined)
      .sort((a, b) => a - b);
    const exact =
      scope.instanceWrites.size > 0 &&
      reasons.length === scope.instanceWrites.size;
    instanceCommit = astFactory.expressionStatement(
      astFactory.callExpression(md(ctx, 'markDirty'), [
        componentId(ctx, compName),
        ...(exact
          ? [
              reasons.length === 1
                ? astFactory.numericLiteral(reasons[0]!)
                : freshReasonConst(ctx, reasons),
            ]
          : []),
      ]),
    );
  }
  const rowOwnerCommit =
    scope.rowOwnerLocal && rowCtx?.ownerIdVar !== undefined
      ? astFactory.expressionStatement(
          astFactory.callExpression(md(ctx, 'markDirty'), [
            astFactory.identifier(rowCtx.ownerIdVar),
          ]),
        )
      : null;

  const combine = (routed: t.Statement | null): t.Statement | null => {
    const parts: t.Statement[] = [];
    for (const source of [...scope.transparentWrites].sort()) {
      parts.push(
        astFactory.expressionStatement(
          astFactory.callExpression(mdd(ctx, 'notifyResolvedValueMutation'), [
            astFactory.identifier(source),
          ]),
        ),
      );
    }
    if (scope.eventOrigin !== null) parts.push(scope.eventOrigin);
    if (rowCommit !== null) parts.push(rowCommit);
    if (rowOwnerCommit !== null) parts.push(rowOwnerCommit);
    if (instanceCommit !== null) parts.push(instanceCommit);
    if (routed !== null) parts.push(routed);
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : astFactory.blockStatement(parts);
  };

  if (scope.rootFallback) {
    // The root subtree contains every more precise destination above. Emitting
    // both forms only schedules the same entity twice and obscures why the
    // conservative fallback was selected.
    return combine(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'markDirtySubtree'), [
          astFactory.stringLiteral(ctx.rootId),
        ]),
      ),
    );
  }
  if (scope.writes.size === 0) return combine(null);

  const overlaps = (left: string, right: string): boolean =>
    left === right ||
    left.startsWith(`${right}.`) ||
    right.startsWith(`${left}.`);
  const structural = [...scope.structuralWrites].filter(
    (write) => ![...scope.contentWrites].some((other) => overlaps(write, other)),
  );
  const ordinary = [...scope.writes].filter(
    (write) => !structural.includes(write),
  );
  const routed: t.Statement[] = [];
  if (ordinary.length > 0) {
    routed.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'commitWrites'), [
          freshWriteConst(ctx, ordinary.sort()),
        ]),
      ),
    );
  }
  if (structural.length > 0) {
    routed.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'commitStructuralWrites'), [
          freshWriteConst(ctx, structural.sort()),
        ]),
      ),
    );
  }
  return combine(
    routed.length === 1 ? routed[0]! : astFactory.blockStatement(routed),
  );
}

/** Commit after return expressions and authored finalizers on normal completion. */
export function appendScopeCommit(
  ctx: Ctx,
  fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  commit: t.Statement,
): void {
  const body = astFactory.isBlockStatement(fn.body)
    ? fn.body.body
    : [astFactory.returnStatement(fn.body as t.Expression)];
  let directiveCount = 0;
  for (const statement of body) {
    if (!astFactory.isExpressionStatement(statement) ||
        !astFactory.isStringLiteral(statement.expression)) break;
    directiveCount++;
  }
  const authored = body.slice(directiveCount);
  if (authored.length === 1 && astFactory.isReturnStatement(authored[0])) {
    const result = generatedIdentifier(ctx, 'returnValue');
    fn.body = astFactory.blockStatement([
      ...body.slice(0, directiveCount),
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          result,
          authored[0].argument ?? astFactory.unaryExpression('void', astFactory.numericLiteral(0), true),
        ),
      ]),
      commit,
      astFactory.returnStatement(astFactory.identifier(result.name)),
    ]);
    return;
  }
  const label = generatedIdentifier(ctx, 'completion');
  const result = generatedIdentifier(ctx, 'returnValue');
  const returns = rewriteReturns(astFactory.blockStatement(authored), label, result);
  if (returns === 0) {
    fn.body = astFactory.blockStatement([...body, commit]);
    return;
  }
  fn.body = astFactory.blockStatement([
    ...body.slice(0, directiveCount),
    astFactory.variableDeclaration('let', [astFactory.variableDeclarator(result)]),
    { type: 'LabeledStatement', label, body: astFactory.blockStatement(authored) } as t.Statement,
    commit,
    astFactory.returnStatement(astFactory.identifier(result.name)),
  ]);
}

function rewriteReturns(node: t.Node, label: t.Identifier, result: t.Identifier): number {
  let count = 0;
  for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
    const record = node as unknown as Record<string, unknown>;
    const child = record[key];
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length; index++) {
        const item = child[index];
        if (!item || typeof item !== 'object' || !('type' in item)) continue;
        const current = item as t.Node;
        if (astFactory.isFunction(current)) continue;
        if (astFactory.isReturnStatement(current)) {
          const statements: t.Statement[] = [];
          if (current.argument !== null) {
            statements.push(astFactory.expressionStatement(
              astFactory.assignmentExpression('=', astFactory.identifier(result.name), current.argument),
            ));
          }
          statements.push({ type: 'BreakStatement', label: astFactory.identifier(label.name) } as t.Statement);
          child[index] = astFactory.blockStatement(statements);
          count++;
        } else {
          count += rewriteReturns(current, label, result);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      const current = child as t.Node;
      if (astFactory.isFunction(current)) continue;
      if (astFactory.isReturnStatement(current)) {
        const statements: t.Statement[] = [];
        if (current.argument !== null) {
          statements.push(astFactory.expressionStatement(
            astFactory.assignmentExpression('=', astFactory.identifier(result.name), current.argument),
          ));
        }
        statements.push({ type: 'BreakStatement', label: astFactory.identifier(label.name) } as t.Statement);
        record[key] = astFactory.blockStatement(statements);
        count++;
      } else {
        count += rewriteReturns(current, label, result);
      }
    }
  }
  return count;
}
