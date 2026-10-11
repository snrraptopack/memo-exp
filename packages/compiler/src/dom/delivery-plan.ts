/** Server delivery and browser binding share the existing initial-content proof. */
import { createHash } from 'node:crypto';
import type { InitialRenderPlan } from '../planning/initial-content';

import type { InitialDelivery } from '../planning/initial-delivery';
export type { InitialDelivery } from '../planning/initial-delivery';

export function planInitialDelivery(
  plan: InitialRenderPlan,
  html: string | null,
  deliveryShape: boolean,
  rootKey: string | undefined,
  sources: ReadonlyMap<string, string>,
  exposedState: boolean,
): InitialDelivery | undefined {
  // An external server entry can change an exported module value before
  // rendering. Such roots need request evaluation, not a captured snapshot.
  if (rootKey === undefined || exposedState || plan.kind === 'browser' || plan.kind === 'mixed')
    return undefined;
  if (
    plan.kind === 'request'
      ? !deliveryShape
      : html === null || (plan.kind === 'bindings' && !deliveryShape)
  )
    return undefined;
  if ('exposedMutableValues' in plan && plan.exposedMutableValues) return undefined;
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        'mmd:initial-delivery:1',
        rootKey,
        plan.target,
        plan,
        [...sources].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      ]),
    )
    .digest('hex');
  return {
    key,
    ...(plan.kind === 'request' || (plan.kind === 'bindings' && plan.request)
      ? {}
      : { html: html! }),
    target: plan.target,
    browser: plan.kind === 'html' || plan.kind === 'request' ? 'none' : 'bindings',
  };
}
