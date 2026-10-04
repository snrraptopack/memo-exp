/** Server delivery and browser binding share the existing initial-content proof. */
import { createHash } from 'node:crypto';
import type { InitialRenderPlan } from './initial-render';

export interface InitialDelivery {
  readonly key: string;
  readonly html: string;
  readonly target: string;
  readonly browser: 'none' | 'bindings';
}

export function planInitialDelivery(
  plan: InitialRenderPlan,
  html: string | null,
  bindingShape: boolean,
  rootKey: string | undefined,
  sources: ReadonlyMap<string, string>,
  exposedState: boolean,
): InitialDelivery | undefined {
  // An external server entry can change an exported module value before
  // rendering. Such roots need request evaluation, not a captured snapshot.
  if (html === null || rootKey === undefined || exposedState ||
      plan.kind !== 'html' && !(plan.kind === 'bindings' && bindingShape)) return undefined;
  if (plan.exposedMutableValues) return undefined;
  const key = createHash('sha256').update(JSON.stringify([
    'mmd:initial-delivery:1', rootKey, plan.target, plan,
    [...sources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  ])).digest('hex');
  return { key, html, target: plan.target, browser: plan.kind === 'html' ? 'none' : 'bindings' };
}
