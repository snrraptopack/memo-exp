/**
 * @fileoverview Path manipulation, pattern validation, and template interpolation for @memoized-dom/router.
 *
 * Implements high-throughput URL pattern matching and path interpolation:
 * - Pre-compiled regex and chunked template caches.
 * - Single-parameter and multi-parameter extraction.
 * - Terminal wildcard capture (/docs/*).
 * - Specificity ranking and comparison for deterministic route tables.
 */

import { createRouteQuery, isMemoizableRouteQuery } from './query';
import type {
  MatchPatternOptions,
  PatternMatch,
  RouteParamValue,
  RouteParams,
  RouteQueryInput,
} from './types';

export { createRouteQuery, parseRouteQuery } from './query';
export { createRouteMatcher } from './matcher';

const PARAM_SEGMENT = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;
const PATTERN_CACHE_LIMIT = 4096;
const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze(Object.create(null));
const compiledPatterns = new Map<string, CompiledPattern>();
const validatedPatternCache = new Map<string, string>();

type PatternChunk =
  | { readonly kind: 'static'; readonly text: string }
  | { readonly kind: 'param'; readonly name: string }
  | { readonly kind: 'wildcard' };

interface CompiledPattern {
  readonly pattern: string;
  readonly keys: readonly string[];
  readonly chunks: readonly PatternChunk[];
  readonly isStatic: boolean;
  readonly end: RegExp;
  readonly prefix: RegExp;
  readonly exactMatch: PatternMatch;
  lastPath?: string;
  lastEnd?: boolean;
  lastResult?: PatternMatch | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits a normalized path into non-empty segment strings.
 */
export function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function patternSegments(pattern: string): string[] {
  return pathSegments(validateRoutePattern(pattern));
}

function segmentKind(segment: string): 1 | 2 | 3 {
  if (segment === '*') return 1;
  if (PARAM_SEGMENT.test(segment)) return 2;
  return 3;
}

let lastCleanPath = '';
let lastCleanResult = '';
const cleanPathCache: Record<string, string> = Object.create(null);
let cleanPathCacheSize = 0;

/**
 * Normalizes a pathname string to ensure a single leading slash and no trailing slash.
 * Fast-paths already normalized paths without string allocation.
 */
export function normalizeRoutePath(path: string): string {
  if (path === '/' || path === '') return '/';
  if (path === lastCleanPath) return lastCleanResult;

  const cached = cleanPathCache[path];
  if (cached !== undefined) {
    lastCleanPath = path;
    lastCleanResult = cached;
    return cached;
  }

  const len = path.length;
  let normalized: string;
  // Fast path for already-normalized paths (starts with '/', does not end with '/', no query/hash/double-slash)
  if (
    path.charCodeAt(0) === 47 /* '/' */ &&
    path.charCodeAt(len - 1) !== 47 /* '/' */ &&
    !path.includes('?') &&
    !path.includes('#') &&
    !path.includes('//')
  ) {
    normalized = path;
  } else {
    const [pathname = ''] = path.split(/[?#]/, 1);
    const trimmed = pathname.replace(/^\/+|\/+$/g, '');
    normalized = trimmed === '' ? '/' : `/${trimmed}`;
  }

  if (cleanPathCacheSize < PATTERN_CACHE_LIMIT) {
    cleanPathCache[path] = normalized;
    cleanPathCacheSize++;
  }
  lastCleanPath = path;
  lastCleanResult = normalized;
  return normalized;
}

const RELATIVE_ROUTE_ORIGIN = 'http://memoized-dom.relative';

/**
 * Resolves a destination relative to a route pathname. Route paths are treated
 * as directories, so `details` from `/projects/one` becomes
 * `/projects/one/details`, while `../two` becomes `/projects/two`.
 */
export function resolveRoutePath(base: string, destination: string): string {
  const baseURL = new URL(base, RELATIVE_ROUTE_ORIGIN);
  if (baseURL.origin !== RELATIVE_ROUTE_ORIGIN) {
    throw new TypeError(`Relative route base '${base}' must be same-origin`);
  }

  let next: URL;
  if (destination === '') {
    next = baseURL;
  } else if (destination.startsWith('?') || destination.startsWith('#')) {
    next = new URL(destination, baseURL);
  } else {
    const directory = new URL(baseURL.href);
    directory.search = '';
    directory.hash = '';
    if (!directory.pathname.endsWith('/')) directory.pathname += '/';
    next = new URL(destination, directory);
  }

  if (next.origin !== RELATIVE_ROUTE_ORIGIN) {
    throw new TypeError(`Relative route destination '${destination}' must be same-origin`);
  }
  return `${normalizeRoutePath(next.pathname)}${next.search}${next.hash}`;
}

let lastJoinParent = '';
let lastJoinChild = '';
let lastJoinResult = '';

/**
 * Combines parent and child route paths safely.
 */
export function joinRoutePaths(parent: string, child: string): string {
  if (parent === lastJoinParent && child === lastJoinChild) return lastJoinResult;

  const base = validateRoutePattern(parent);
  const nested = validateRoutePattern(child);
  let result: string;
  if (nested === '/') {
    result = base;
  } else if (base === '/') {
    result = nested;
  } else {
    result = validateRoutePattern(`${base}${nested}`);
  }

  lastJoinParent = parent;
  lastJoinChild = child;
  lastJoinResult = result;
  return result;
}

/**
 * Validates and normalizes a route pattern declaration.
 * Results are cached to avoid repeated Set allocations and segment parsing.
 */
export function validateRoutePattern(pattern: string): string {
  const cached = validatedPatternCache.get(pattern);
  if (cached !== undefined) return cached;

  if (pattern.includes('?') || pattern.includes('#')) {
    throw new TypeError(`Route pattern '${pattern}' must not contain a query or hash`);
  }
  if (pattern.includes('//')) {
    throw new TypeError(`Route pattern '${pattern}' contains an empty path segment`);
  }

  const normalized = normalizeRoutePath(pattern);
  const names = new Set<string>();
  const segments = pathSegments(normalized);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment === '*') {
      if (index !== segments.length - 1) {
        throw new TypeError(`Route wildcard must be terminal in '${pattern}'`);
      }
      continue;
    }
    if (!segment.startsWith(':')) continue;
    const parameter = PARAM_SEGMENT.exec(segment);
    if (parameter === null) {
      throw new TypeError(`Invalid route parameter segment '${segment}' in '${pattern}'`);
    }
    const name = parameter[1]!;
    if (names.has(name)) {
      throw new TypeError(`Duplicate route parameter '${name}' in '${pattern}'`);
    }
    names.add(name);
  }
  if (validatedPatternCache.size >= PATTERN_CACHE_LIMIT) {
    const oldest = validatedPatternCache.keys().next().value as string | undefined;
    if (oldest !== undefined) validatedPatternCache.delete(oldest);
  }
  validatedPatternCache.set(pattern, normalized);
  return normalized;
}

/**
 * Validates an array of route pattern declarations, detecting duplicate IDs and ambiguous definitions.
 */
export function validateRoutePatterns(
  definitions: readonly { readonly id: string; readonly pattern: string }[],
): void {
  const seenIds = new Set<string>();
  const seenSignatures = new Map<string, string>();

  for (const def of definitions) {
    if (seenIds.has(def.id)) {
      throw new TypeError(`Duplicate route ID '${def.id}'`);
    }
    seenIds.add(def.id);

    const normalized = validateRoutePattern(def.pattern);
    const signature = normalized
      .split('/')
      .map(segment => {
        if (segment === '*') return '*';
        if (segment.startsWith(':')) return ':param';
        return segment;
      })
      .join('/');

    const existing = seenSignatures.get(signature);
    if (existing !== undefined && existing !== def.id) {
      throw new TypeError(
        `Ambiguous routes '${existing}' and '${def.id}' share pattern signature '${signature}'`,
      );
    }
    seenSignatures.set(signature, def.id);
  }
}

/**
 * Compiles a route pattern into cached regular expressions, parameter keys, and template chunks.
 */
function compilePattern(pattern: string): CompiledPattern {
  const normalized = validateRoutePattern(pattern);
  const cached = compiledPatterns.get(normalized);
  if (cached !== undefined) return cached;

  const keys: string[] = [];
  const chunks: PatternChunk[] = [];
  const segments = pathSegments(normalized);
  let body = '';

  for (const segment of segments) {
    if (segment === '*') {
      keys.push('*');
      chunks.push({ kind: 'wildcard' });
      body += '(?:/(.*))?';
      continue;
    }
    const param = PARAM_SEGMENT.exec(segment);
    if (param !== null) {
      const name = param[1]!;
      keys.push(name);
      chunks.push({ kind: 'param', name });
      body += '/([^/]+)';
      continue;
    }
    chunks.push({ kind: 'static', text: `/${segment}` });
    body += `/${escapeRegExp(segment)}`;
  }

  if (segments.length === 0) body = '/';
  const source = body === '/' ? '' : body;
  const isStatic = keys.length === 0 && !normalized.includes('*') && !normalized.includes(':');
  const exactMatch: PatternMatch = Object.freeze({
    pattern: normalized,
    pathname: normalized,
    params: EMPTY_PARAMS,
    consumed: normalized,
    remaining: '/',
  });
  const compiled: CompiledPattern = {
    pattern: normalized,
    keys,
    chunks,
    isStatic,
    end: new RegExp(`^${source || '/'}/*$`),
    prefix: new RegExp(`^${source || ''}(?=/|$)`),
    exactMatch,
  };
  if (compiledPatterns.size >= PATTERN_CACHE_LIMIT) {
    const oldest = compiledPatterns.keys().next().value as string | undefined;
    if (oldest !== undefined) compiledPatterns.delete(oldest);
  }
  compiledPatterns.set(normalized, compiled);
  return compiled;
}

/**
 * Decodes a URI component safely, falling back to the raw value on malformed URI sequences.
 */
export function decodePathValue(value: string): string {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Matches a route pattern against an incoming pathname string.
 *
 * Fast-paths exact static routes without RegExp evaluation and memoizes active matches.
 */
export function matchRoutePattern(
  pattern: string,
  pathname: string,
  options: MatchPatternOptions = {},
): PatternMatch | null {
  const compiled = compilePattern(pattern);
  const normalizedPathname = normalizeRoutePath(pathname);
  const matchEnd = options.end ?? true;

  if (compiled.lastPath === normalizedPathname && compiled.lastEnd === matchEnd) {
    return compiled.lastResult!;
  }

  let result: PatternMatch | null = null;

  // Fast-path 1: Static exact match
  if (compiled.isStatic) {
    if (matchEnd) {
      if (normalizedPathname === compiled.pattern) {
        result = compiled.exactMatch;
      }
    } else if (
      compiled.pattern === '/' ||
      normalizedPathname === compiled.pattern ||
      normalizedPathname.startsWith(`${compiled.pattern}/`)
    ) {
      const rest = compiled.pattern === '/'
        ? normalizedPathname
        : normalizedPathname.slice(compiled.pattern.length);
      result = {
        pattern: compiled.pattern,
        pathname: normalizedPathname,
        params: EMPTY_PARAMS,
        consumed: compiled.pattern,
        remaining: rest === '' || rest === '/' ? '/' : normalizeRoutePath(rest),
      };
    }
  } else {
    // Dynamic parameterized or wildcard match via compiled regex
    const matcher = matchEnd ? compiled.end : compiled.prefix;
    const match = matcher.exec(normalizedPathname);
    if (match !== null) {
      let params: Readonly<Record<string, string>>;
      if (compiled.keys.length === 0) {
        params = EMPTY_PARAMS;
      } else {
        const extracted: Record<string, string> = {};
        for (let index = 0; index < compiled.keys.length; index++) {
          const value = match[index + 1];
          if (value !== undefined) {
            extracted[compiled.keys[index]!] = decodePathValue(value);
          }
        }
        params = Object.freeze(extracted);
      }

      const consumed = match[0] === '' ? '/' : match[0]!;
      const rest = normalizedPathname.slice(match[0]!.length);
      result = {
        pattern: compiled.pattern,
        pathname: normalizedPathname,
        params,
        consumed,
        remaining: rest === '' ? '/' : normalizeRoutePath(rest),
      };
    }
  }

  compiled.lastPath = normalizedPathname;
  compiled.lastEnd = matchEnd;
  compiled.lastResult = result;
  return result;
}

function encodePathSegment(text: string, name: string): string {
  if (text === '.' || text === '..') {
    throw new TypeError(`Route parameter '${name}' must not be a dot segment`);
  }
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (
      (c >= 97 && c <= 122) ||
      (c >= 65 && c <= 90) ||
      (c >= 48 && c <= 57) ||
      c === 45 ||
      c === 95 ||
      c === 46
    ) {
      continue;
    }
    return encodeURIComponent(text);
  }
  return text;
}

let lastBuildPattern: unknown = undefined;
let lastBuildParams: unknown = undefined;
let lastBuildQuery: unknown = undefined;
let lastBuildHash: unknown = undefined;
let lastBuildResult = '';

/**
 * Interpolates parameters, query inputs, and hash fragments into a concrete URL path.
 *
 * Fast-paths static patterns and chunked templates without regex evaluation.
 */
export function buildRoutePath<Path extends string>(
  pattern: Path,
  params?: RouteParams<Path>,
  query?: RouteQueryInput,
  hash?: string,
): string {
  const memoizable = (params === undefined || Object.isFrozen(params)) &&
    isMemoizableRouteQuery(query);
  if (
    memoizable &&
    pattern === lastBuildPattern &&
    params === lastBuildParams &&
    query === lastBuildQuery &&
    hash === lastBuildHash
  ) {
    return lastBuildResult;
  }

  let result: string;

  // Fast path for static path without query/hash
  if (
    params === undefined &&
    query === undefined &&
    hash === undefined &&
    !pattern.includes(':') &&
    !pattern.includes('*')
  ) {
    result = normalizeRoutePath(pattern);
  } else {
    const compiled = compilePattern(pattern);
    if (compiled.isStatic) {
      const queryStr = createRouteQuery(query);
      const hashStr = hash === undefined || hash === ''
        ? ''
        : hash.startsWith('#') ? hash : `#${hash}`;
      result = `${compiled.pattern}${queryStr}${hashStr}`;
    } else {
      const supplied = params as Readonly<Record<string, RouteParamValue>> | undefined;
      let pathname = '';
      for (let i = 0; i < compiled.chunks.length; i++) {
        const chunk = compiled.chunks[i]!;
        if (chunk.kind === 'static') {
          pathname += chunk.text;
        } else if (chunk.kind === 'param') {
          const value = supplied?.[chunk.name];
          if (value === undefined) {
            throw new TypeError(`Missing route parameter '${chunk.name}' for '${pattern}'`);
          }
          pathname += `/${encodePathSegment(String(value), chunk.name)}`;
        } else {
          const value = supplied?.['*'];
          if (value === undefined) {
            throw new TypeError(`Missing route parameter '*' for '${pattern}'`);
          }
          const wildcard = String(value);
          const segments = wildcard.split('/');
          if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
            throw new TypeError(`Route wildcard '*' contains an invalid path segment`);
          }
          for (let s = 0; s < segments.length; s++) {
            pathname += `/${encodePathSegment(segments[s]!, '*')}`;
          }
        }
      }

      if (pathname === '') pathname = '/';
      const queryStr = createRouteQuery(query);
      const normalizedHash = hash === undefined || hash === ''
        ? ''
        : hash.startsWith('#') ? hash : `#${hash}`;
      result = `${pathname}${queryStr}${normalizedHash}`;
    }
  }

  if (memoizable) {
    lastBuildPattern = pattern;
    lastBuildParams = params;
    lastBuildQuery = query;
    lastBuildHash = hash;
    lastBuildResult = result;
  }
  return result;
}

/**
 * Calculates the specificity ranking integer for a route pattern.
 */
export function rankRoutePattern(pattern: string): number {
  let rank = 1;
  for (const segment of patternSegments(pattern)) {
    rank = rank * 4 + segmentKind(segment);
  }
  return rank;
}

/**
 * Compares two route patterns for sorting. More specific routes sort first.
 */
export function compareRoutePatterns(first: string, second: string): number {
  const left = patternSegments(first);
  const right = patternSegments(second);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === undefined) return 1;
    if (rightSegment === undefined) return -1;
    if (leftSegment === rightSegment) continue;
    return segmentKind(rightSegment) - segmentKind(leftSegment);
  }
  return 0;
}
