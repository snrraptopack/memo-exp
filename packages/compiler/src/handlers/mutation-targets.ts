import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { writeTouchesKey, type KeyedListMutationPlan } from '../context';
import { type Ctx } from '../context';
import type { RowWriteFacts } from './write-facts';
import { directItemWrite } from '../lists/item-write';

export function directListItemMutationKey(
  node: t.MemberExpression,
  plan: KeyedListMutationPlan,
): t.Expression | null {
  const write = directItemWrite(node);
  if (write === null || write.source !== plan.source || writeTouchesKey(write.path, plan.keyPath)) return null;
  const { itemAccess } = write;

  let key: t.Expression = cloneEstreeNode(itemAccess, true);
  for (const segment of plan.keyPath) {
    key = astFactory.memberExpression(key, astFactory.identifier(segment));
  }
  return key;
}

/** Vars a write-set routes to: components ∪ a pseudo-reader for list rows. */
function readersOfVar(ctx: Ctx, v: string): Set<string> {
  const out = new Set<string>();
  for (const [comp, vars] of ctx.compReads) {
    if (vars.has(v)) out.add(comp);
  }
  for (const site of ctx.rowReads.values()) {
    if (site.vars.has(v)) out.add('__rows__'); // multi-instance by construction
  }
  for (const site of ctx.condReads.values()) {
    if (site.vars.has(v)) out.add('__regions__'); // region-updated, not owner-updated
  }
  return out;
}
/**
 * R11.1: can anything OTHER than the row's own list observe item-field
 * mutations? The row-local commit (markDirty/update on the row alone) is
 * sound only when the answer is no. List owners are excluded — their
 * map-source read is inherent to the list pattern and the reconcile
 * resyncs their rows (see spec §11.3 for the residual case of an owner
 * deriving item fields inline, outside a computed).
 */
export function itemFieldVisibleBeyondList(
  ctx: Ctx,
  compName: string | null,
  rowCtx: RowWriteFacts,
): boolean {
  if (rowCtx.sourceLocal) return true;
  const source = rowCtx.sourceKey;
  if (source === '') return true; // unknown source -> conservative
  for (const info of ctx.computeds.values()) {
    if (info.reads.has(source)) return true;
  }
  const owners = new Set((ctx.listedSites.get(compName ?? '') ?? []).map((s) => s.owner));
  if (owners.size === 0 && compName !== null) owners.add(compName); // inline rows
  for (const reader of readersOfVar(ctx, source)) {
    if (reader === '__rows__' || reader === '__regions__') return true;
    if (!owners.has(reader)) return true;
  }
  return false;
}
