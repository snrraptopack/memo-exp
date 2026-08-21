import { createRouteMatcher } from './matcher';
import {
  buildRoutePath,
  joinRoutePaths,
  matchRoutePattern,
  pathSegments,
  validateRoutePattern,
} from './path';
import type {
  NavigateOptions,
  RouteLocationSnapshot,
  RouteManifest,
  RouteManifestEntry,
  RouteMatch,
  RoutePatternDefinition,
} from './types';

interface PreparedManifestEntry extends RouteManifestEntry {
  readonly ownParamNames: readonly string[];
  readonly parent: PreparedManifestEntry | null;
}

const EMPTY_MATCHES: readonly RouteMatch[] = Object.freeze([]);

function patternSignature(pattern: string): string {
  return pathSegments(pattern)
    .map(segment => segment === '*' ? '*' : segment.startsWith(':') ? ':param' : segment)
    .join('/');
}

function ownParamNames(pattern: string): readonly string[] {
  const names: string[] = [];
  for (const segment of pathSegments(pattern)) {
    if (segment === '*') names.push('*');
    else if (segment.startsWith(':')) names.push(segment.slice(1));
  }
  return Object.freeze(names);
}

function isAncestor(
  ancestor: PreparedManifestEntry,
  descendant: PreparedManifestEntry,
): boolean {
  let current = descendant.parent;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Builds a validated nested route manifest.
 *
 * This is the runtime form of the structure the compiler can emit ahead of
 * time. Parent IDs determine active match chains; child patterns remain local
 * while `fullPattern` is precomposed for matching and destination generation.
 */
export function createRouteManifest(
  definitions: readonly (RoutePatternDefinition | string)[],
): RouteManifest {
  const rawById = new Map<string, RoutePatternDefinition>();
  for (const definition of definitions) {
    const item = typeof definition === 'string'
      ? { id: definition, pattern: definition }
      : definition;
    if (item.id.trim() === '') throw new TypeError('Route IDs must not be empty');
    if (rawById.has(item.id)) throw new TypeError(`Duplicate route ID '${item.id}'`);
    rawById.set(item.id, item);
  }

  const preparedById = new Map<string, PreparedManifestEntry>();
  const visiting = new Set<string>();

  function prepare(id: string): PreparedManifestEntry {
    const cached = preparedById.get(id);
    if (cached !== undefined) return cached;
    const definition = rawById.get(id);
    if (definition === undefined) throw new TypeError(`Unknown route ID '${id}'`);
    if (visiting.has(id)) {
      throw new TypeError(`Route parent cycle includes '${id}'`);
    }
    visiting.add(id);
    try {
      const pattern = validateRoutePattern(definition.pattern);
      let parent: PreparedManifestEntry | null = null;
      let fullPattern = pattern;
      let depth = 0;
      if (definition.parentId !== undefined) {
        if (!rawById.has(definition.parentId)) {
          throw new TypeError(
            `Route '${id}' references missing parent '${definition.parentId}'`,
          );
        }
        parent = prepare(definition.parentId);
        const inheritedNames = new Set(ownParamNames(parent.fullPattern));
        for (const name of ownParamNames(pattern)) {
          if (inheritedNames.has(name)) {
            throw new TypeError(`Route '${id}' shadows active parameter '${name}'`);
          }
        }
        fullPattern = joinRoutePaths(parent.fullPattern, pattern);
        depth = parent.depth + 1;
      }

      const entry: PreparedManifestEntry = Object.freeze({
        id: definition.id,
        pattern,
        parentId: definition.parentId,
        metadata: definition.metadata,
        fullPattern,
        depth,
        ownParamNames: ownParamNames(pattern),
        parent,
      });
      preparedById.set(id, entry);
      return entry;
    } finally {
      visiting.delete(id);
    }
  }

  for (const id of rawById.keys()) prepare(id);
  const entries = [...preparedById.values()].sort((left, right) =>
    left.depth - right.depth);

  const signatureOwners = new Map<string, PreparedManifestEntry>();
  for (const entry of entries) {
    const signature = patternSignature(entry.fullPattern);
    const existing = signatureOwners.get(signature);
    if (
      existing !== undefined &&
      !isAncestor(existing, entry) &&
      !isAncestor(entry, existing)
    ) {
      throw new TypeError(
        `Ambiguous routes '${existing.id}' and '${entry.id}' share pattern signature '${signature}'`,
      );
    }
    signatureOwners.set(signature, entry);

    const names = new Set<string>();
    const chain: PreparedManifestEntry[] = [];
    let current: PreparedManifestEntry | null = entry;
    while (current !== null) {
      chain.push(current);
      current = current.parent;
    }
    for (let index = chain.length - 1; index >= 0; index--) {
      for (const name of chain[index]!.ownParamNames) {
        if (names.has(name)) {
          throw new TypeError(
            `Route '${entry.id}' shadows active parameter '${name}'`,
          );
        }
        names.add(name);
      }
    }
  }

  const table = createRouteMatcher(entries.map(entry => ({
    id: entry.id,
    pattern: entry.fullPattern,
  })));
  const publicEntries: readonly RouteManifestEntry[] = Object.freeze(
    entries.map(entry => Object.freeze({
      id: entry.id,
      pattern: entry.pattern,
      parentId: entry.parentId,
      metadata: entry.metadata,
      fullPattern: entry.fullPattern,
      depth: entry.depth,
    })),
  );

  function matchAll(pathname: string): readonly RouteMatch[] {
    const leafMatch = table.match(pathname);
    if (leafMatch === null) return EMPTY_MATCHES;
    const leaf = preparedById.get(leafMatch.id)!;
    const chain: PreparedManifestEntry[] = [];
    let current: PreparedManifestEntry | null = leaf;
    while (current !== null) {
      chain.push(current);
      current = current.parent;
    }
    chain.reverse();

    const matches: RouteMatch[] = new Array(chain.length);
    for (let index = 0; index < chain.length; index++) {
      const entry = chain[index]!;
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
  }

  return Object.freeze({
    entries: publicEntries,
    get(id: string) {
      return publicEntries.find(entry => entry.id === id);
    },
    match(pathname: string) {
      const matches = matchAll(pathname);
      return matches.at(-1) ?? null;
    },
    matchAll,
    resolve(location: RouteLocationSnapshot) {
      return matchAll(location.pathname);
    },
    build(id: string, options: NavigateOptions<string> = {}) {
      const entry = preparedById.get(id);
      if (entry === undefined) throw new TypeError(`Unknown route ID '${id}'`);
      return buildRoutePath(
        entry.fullPattern,
        options.params,
        options.query,
        options.hash,
      );
    },
  });
}
