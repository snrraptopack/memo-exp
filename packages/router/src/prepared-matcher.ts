import { createRouteMatcher } from './matcher';
import { matchRoutePattern } from './path';
import type { RouteMatch } from './types';

/** Validated graph facts supplied by the compiler or the public manifest builder. */
export interface PreparedRouteEntry {
  readonly id: string;
  readonly pattern: string;
  readonly fullPattern: string;
  readonly ownParamNames: readonly string[];
  readonly chain: readonly number[];
  readonly metadata?: unknown;
}

const EMPTY_MATCHES: readonly RouteMatch[] = Object.freeze([]);

/** Shared route execution; graph validation and composition belong to its producer. */
export function createPreparedRouteMatcher(
  entries: readonly PreparedRouteEntry[],
): (pathname: string) => readonly RouteMatch[] {
  const table = createRouteMatcher(entries.map(entry => ({
    id: entry.id, pattern: entry.fullPattern,
  })));
  const byId = new Map(entries.map(entry => [entry.id, entry]));

  return pathname => {
    const leafMatch = table.match(pathname);
    if (leafMatch === null) return EMPTY_MATCHES;
    const chain = byId.get(leafMatch.id)!.chain;
    const matches: RouteMatch[] = new Array(chain.length);
    for (let index = 0; index < chain.length; index++) {
      const entry = entries[chain[index]!]!;
      const patternMatch = matchRoutePattern(entry.fullPattern, pathname, {
        end: index === chain.length - 1,
      });
      if (patternMatch === null) {
        throw new Error(`Resolved route '${entry.id}' did not match '${pathname}'`);
      }
      const params: Record<string, string> = {};
      for (const name of entry.ownParamNames) {
        const value = patternMatch.params[name];
        if (value !== undefined) params[name] = value;
      }
      matches[index] = Object.freeze({
        id: entry.id,
        pattern: entry.pattern,
        pathname: patternMatch.consumed,
        params: Object.freeze(params),
        metadata: entry.metadata,
      });
    }
    return Object.freeze(matches);
  };
}
