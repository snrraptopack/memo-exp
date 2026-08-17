/**
 * @fileoverview Path manipulation, pattern validation, and template interpolation for @memoized-dom/router.
 *
 * Implements high-throughput URL pattern matching and path interpolation:
 * - Pre-compiled regex and chunked template caches.
 * - Single-parameter and multi-parameter extraction.
 * - Terminal wildcard capture (/docs/*).
 * - Specificity ranking and comparison for deterministic route tables.
 */

import { createRouteQuery } from './query';
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

const cleanPathCache = new Map<string, string>();

/**
 * Normalizes a pathname string to ensure a single leading slash and no trailing slash.
 * Fast-paths already normalized paths without string allocation.
 */
export function normalizeRoutePath(path: string): string {
  if (path === '/' || path === '') return '/';
  const cached = cleanPathCache.get(path);
  if (cached !== undefined) return cached;

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

  if (cleanPathCache.size >= PATTERN_CACHE_LIMIT) {
    const oldest = cleanPathCache.keys().next().value as string | undefined;
    if (oldest !== undefined) cleanPathCache.delete(oldest);
  }
  cleanPathCache.set(path, normalized);
  return normalized;
}

/**
 * Combines parent and child route paths safely.
 */
export function joinRoutePaths(parent: string, child: string): string {
  const base = validateRoutePattern(parent);
  const nested = validateRoutePattern(child);
  if (nested === '/') return base;
  if (base === '/') return nested;
  return validateRoutePattern(`${base}${nested}`);
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
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Matches a route pattern against an incoming pathname string.
 *
 * Fast-paths exact static routes without RegExp evaluation.
 */
export function matchRoutePattern(
  pattern: string,
  pathname: string,
  options: MatchPatternOptions = {},
): PatternMatch | null {
  const compiled = compilePattern(pattern);
  const normalizedPathname = normalizeRoutePath(pathname);
  const matchEnd = options.end ?? true;

  // Fast-path 1: Static exact match
  if (compiled.isStatic) {
    if (matchEnd) {
      if (normalizedPathname === compiled.pattern) {
        return compiled.exactMatch;
      }
      return null;
    }
    // Static prefix match
    if (
      normalizedPathname === compiled.pattern ||
      normalizedPathname.startsWith(`${compiled.pattern}/`)
    ) {
      const rest = normalizedPathname.slice(compiled.pattern.length);
      return {
        pattern: compiled.pattern,
        pathname: normalizedPathname,
        params: EMPTY_PARAMS,
        consumed: compiled.pattern,
        remaining: rest === '' ? '/' : normalizeRoutePath(rest),
      };
    }
    return null;
  }

  // Dynamic parameterized or wildcard match via compiled regex
  const matcher = matchEnd ? compiled.end : compiled.prefix;
  const match = matcher.exec(normalizedPathname);
  if (match === null) return null;

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
  return {
    pattern: compiled.pattern,
    pathname: normalizedPathname,
    params,
    consumed,
    remaining: rest === '' ? '/' : normalizeRoutePath(rest),
  };
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
  // Fast path for static path without query/hash
  if (
    params === undefined &&
    query === undefined &&
    hash === undefined &&
    !pattern.includes(':') &&
    !pattern.includes('*')
  ) {
    return normalizeRoutePath(pattern);
  }

  const compiled = compilePattern(pattern);
  if (compiled.isStatic) {
    const queryStr = createRouteQuery(query);
    const hashStr = hash === undefined || hash === ''
      ? ''
      : hash.startsWith('#') ? hash : `#${hash}`;
    return `${compiled.pattern}${queryStr}${hashStr}`;
  }

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
  return `${pathname}${queryStr}${normalizedHash}`;
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
