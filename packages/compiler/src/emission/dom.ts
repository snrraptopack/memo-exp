/** DOM backend consumes planned component structure; it does not discover it. */
import type { Ctx } from '../context';
import type { ModuleRenderPlan } from '../planning/component-render';
import { transformComponent } from './component';

export function emitDomComponents(ctx: Ctx, plan: ModuleRenderPlan): void {
  for (const component of plan.components) transformComponent(ctx, component);
}
