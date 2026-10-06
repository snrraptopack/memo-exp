/** Shared authored mutation-journal candidates, independent of backend names. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst } from '../ast';
import { keyPathOf, writeTouchesKey, type KeyedListMutationPlan, type MapCallExpression } from '../context';
import { directItemWrite } from '../lists/item-write';

export interface ListMutationCandidate {
  readonly source: string;
  readonly keyPath: string[];
}
export interface ComponentItemWrites {
  readonly hasNonKeyWrite: (source: string, keyPath: string[]) => boolean;
}

/**
 * Collect candidate shapes once per owner. This deliberately is not a safety
 * proof: handler routing separately checks lexical origins, accessors and plain
 * data. Writes in nested callbacks keep their existing candidate behavior.
 */
export function collectComponentItemWrites(component: t.FunctionDeclaration): ComponentItemWrites {
  const paths = new Map<string, string[][]>();
  walkAst<t.Node>(component.body, { enter(node) {
    const target = astFactory.isAssignmentExpression(node) && astFactory.isMemberExpression(node.left)
      ? node.left
      : astFactory.isUpdateExpression(node) && astFactory.isMemberExpression(node.argument)
        ? node.argument
        : astFactory.isUnaryExpression(node, { operator: 'delete' }) && astFactory.isMemberExpression(node.argument)
          ? node.argument : null;
    if (target === null) return;
    const write = directItemWrite(target);
    if (write === null) return;
    const sourcePaths = paths.get(write.source) ?? [];
    sourcePaths.push(write.path);
    paths.set(write.source, sourcePaths);
  }});
  return { hasNonKeyWrite: (source, keyPath) =>
    paths.get(source)?.some(path => !writeTouchesKey(path, keyPath)) === true };
}

/** Candidate eligibility has no generated IDs, dirty reasons or DOM operations. */
export function planListMutationCandidate(
  site: { sourceLocal: boolean; sourceExpr: t.Expression; keyExpr: t.Expression | null; itemParam: string },
  ownerState: ReadonlySet<string>, writes: ComponentItemWrites,
): ListMutationCandidate | null {
  if (!site.sourceLocal || !astFactory.isIdentifier(site.sourceExpr)) return null;
  const source = site.sourceExpr.name;
  if (!ownerState.has(source)) return null;
  const keyPath = keyPathOf(site.keyExpr, site.itemParam);
  if (keyPath === null || keyPath.length === 0 || !writes.hasNonKeyWrite(source, keyPath)) return null;
  return {source, keyPath};
}

export interface ComponentMutationJournals {
  readonly forSource: (source: string) => KeyedListMutationPlan | undefined;
  readonly forCall: (call: MapCallExpression) => KeyedListMutationPlan | undefined;
}

/**
 * Freeze copies of the final unique-source journals before backend mutation.
 * Source/key identities and semantic causes survive factory replacement.
 * Generated journal variables are allocated separately by the backend.
 */
export function captureMutationJournals(
  sources: ReadonlyMap<string, KeyedListMutationPlan> | undefined,
): ComponentMutationJournals {
  const bySource = new Map<string, KeyedListMutationPlan>();
  const byCall = new WeakMap<MapCallExpression, KeyedListMutationPlan>();
  for (const [source, journal] of sources ?? []) {
    const copied = Object.freeze({...journal, keyPath: Object.freeze([...journal.keyPath])});
    bySource.set(source, copied);
    byCall.set(journal.call, copied);
  }
  return {forSource: source => bySource.get(source), forCall: call => byCall.get(call)};
}
