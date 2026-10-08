/** Dynamic/public resolvers validate and copy authored match records. */
import type { RouteMatch } from './types';
import { validateRoutePattern } from './path';

function frozenMatch(match: RouteMatch): RouteMatch {
  return Object.freeze({
    ...match,
    params: Object.freeze({ ...match.params }),
  });
}

export function validateRouteMatches(nextMatches: readonly RouteMatch[]): {
  readonly matches: readonly RouteMatch[];
  readonly params: Readonly<Record<string, string>>;
} {
  const len = nextMatches.length;
  if (len === 0) {
    return {
      matches: Object.freeze([]),
      params: Object.freeze({}),
    };
  }

  // Fast single-match path (no Set allocation, for..in iteration)
  if (len === 1) {
    const match = nextMatches[0]!;
    if (match.id.trim() === '') throw new TypeError('Route match IDs must not be empty');
    const pattern = validateRoutePattern(match.pattern);
    const merged: Record<string, string> = {};
    for (const key in match.params) {
      merged[key] = match.params[key]!;
    }
    return {
      matches: Object.freeze([frozenMatch({ ...match, pattern })]),
      params: Object.freeze(merged),
    };
  }

  const identifiers = new Set<string>();
  const merged: Record<string, string> = {};
  const frozen: RouteMatch[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const match = nextMatches[i]!;
    if (match.id.trim() === '') throw new TypeError('Route match IDs must not be empty');
    if (identifiers.has(match.id)) {
      throw new TypeError(`Duplicate active route ID '${match.id}'`);
    }
    identifiers.add(match.id);
    const pattern = validateRoutePattern(match.pattern);
    for (const key in match.params) {
      if (Object.hasOwn(merged, key)) {
        throw new TypeError(`Duplicate active route parameter '${key}'`);
      }
      merged[key] = match.params[key]!;
    }
    frozen[i] = frozenMatch({ ...match, pattern });
  }
  return {
    matches: Object.freeze(frozen),
    params: Object.freeze(merged),
  };
}
