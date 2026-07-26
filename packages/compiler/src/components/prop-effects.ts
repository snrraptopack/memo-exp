/**
 * Maps defining-module prop mutations to caller-resolved state boundaries.
 */
import type { Ctx, RowCtx } from '../context';
import type { ScopeWrites } from '../handler-commits';
import type { ReactiveOrigin } from '../mutation-analysis';
import {
  objectBindingName,
  propNameForBinding,
} from './props';

interface PropAccess {
  name: string;
  path: string[];
}

function propAccess(
  ctx: Ctx,
  component: string,
  origin: ReactiveOrigin,
): PropAccess | null {
  if (origin.key === null) return null;
  const plan = ctx.componentProps.get(component);
  if (plan === undefined) return null;

  const genericProps = objectBindingName(plan);
  if (origin.root === genericProps) {
    const [name, ...path] = origin.key.split('.').slice(1);
    return name === undefined ? null : { name, path };
  }

  const name = propNameForBinding(plan, origin.root);
  return name === null
    ? null
    : {
        name,
        path: origin.key.split('.').slice(1),
      };
}

/**
 * Applies one prop effect and returns whether the origin is a named prop.
 */
export function applyLinkedPropEffect(
  ctx: Ctx,
  component: string,
  rowCtx: RowCtx | undefined,
  origin: ReactiveOrigin,
  scope: ScopeWrites,
): boolean {
  const access = propAccess(ctx, component, origin);
  if (access === null) return false;

  if (rowCtx === undefined) {
    scope.instanceLocal = true;
  } else {
    scope.rowLocal = true;
  }

  const source =
    ctx.linkedComponentPropSources.get(component)?.get(access.name);
  if (source === undefined) {
    scope.rootFallback = true;
    return true;
  }
  scope.rootFallback ||= source.rootFallback;
  const suffix =
    access.path.length === 0 ? '' : `.${access.path.join('.')}`;
  for (const key of source.keys) scope.writes.add(`${key}${suffix}`);
  return true;
}
