import type { RouteState } from './types';

/** @internal Identity of one matched region, excluding query/hash refreshes. */
export function routeRegionIdentity(route: RouteState, id: string): string | null {
  const match = route.matches.find(candidate => candidate.id === id);
  // The consumed pathname contains inherited as well as local parameters.
  // Child changes therefore leave an unchanged parent layout instance intact.
  return match === undefined ? null : JSON.stringify([id, match.pathname]);
}
