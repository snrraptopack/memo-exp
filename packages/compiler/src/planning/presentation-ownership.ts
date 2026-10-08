/** Presentation propagation requirements, independent of a factory ABI. */
import type { Ctx } from '../context/model';

export interface PresentationOwner {
  readonly component: string;
  readonly mode: 'local' | 'inherited';
}

/** A local policy/source requirement takes precedence over pass-through. */
export function requirePresentationOwner(
  ctx: Pick<Ctx, 'presentationOwners'>,
  component: string,
  mode: PresentationOwner['mode'] = 'local',
): PresentationOwner {
  const existing = ctx.presentationOwners.get(component);
  if (existing !== undefined && (existing.mode === 'local' || mode === 'inherited')) return existing;
  const owner = { component, mode };
  ctx.presentationOwners.set(component, owner);
  return owner;
}
