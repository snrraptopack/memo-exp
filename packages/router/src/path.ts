import type {
  MatchPatternOptions,
  PatternMatch,
  RoutePatternDefinition,
  RouteParamValue,
  RouteParams,
  RouteQueryInput,
  RouteQueryValue,
} from './types';

const PARAM_SEGMENT = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;
const PATTERN_CACHE_LIMIT = 512;
const compiledPatterns = new Map<string, CompiledPattern>();

interface CompiledPattern {
  readonly pattern: string;
  readonly keys: readonly string[];
  readonly end: RegExp;
  readonly prefix: RegExp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathSegments(path: string): string[] {
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

export function normalizeRoutePath(path: string): string {
  const [pathname = ''] = path.split(/[?#]/, 1);
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '' ? '/' : normalized;
}

export function joinRoutePaths(parent: string, child: string): string {
  const base = validateRoutePattern(parent);
  const nested = validateRoutePattern(child);
  if (nested === '/') return base;
  if (base === '/') return nested;
  return validateRoutePattern(`${base}${nested}`);
}

/** Validate and normalize a full route pattern. */
export function validateRoutePattern(pattern: string): string {
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
  return normalized;
}

/**
 * Compare route specificity for Array#sort. More specific patterns sort first.
 * Static segments beat parameters, which beat terminal wildcards, at the first
 * segment where the patterns differ.
 */
export function compareRoutePatterns(first: string, second: string): number {
  const left = patternSegments(first);
  const right = patternSegments(second);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === undefined) {
      return rightSegment === '*' ? -1 : 1;
    }
    if (rightSegment === undefined) {
      return leftSegment === '*' ? 1 : -1;
    }
    const difference = segmentKind(rightSegment) - segmentKind(leftSegment);
    if (difference !== 0) return difference;
  }
  return 0;
}

function routePatternsOverlap(first: string, second: string): boolean {
  const left = patternSegments(first);
  const right = patternSegments(second);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === '*' || rightSegment === '*') return true;
    if (leftSegment === undefined || rightSegment === undefined) return false;
    if (
      segmentKind(leftSegment) === 3 &&
      segmentKind(rightSegment) === 3 &&
      leftSegment !== rightSegment
    ) return false;
  }
  return true;
}

/** Validate a flattened route table before it is installed by generated code. */
export function validateRoutePatterns(
  definitions: readonly RoutePatternDefinition[],
): void {
  const identifiers = new Set<string>();
  for (const definition of definitions) {
    if (definition.id.trim() === '') throw new TypeError('Route IDs must not be empty');
    if (identifiers.has(definition.id)) {
      throw new TypeError(`Duplicate route ID '${definition.id}'`);
    }
    identifiers.add(definition.id);
    validateRoutePattern(definition.pattern);
  }

  for (let left = 0; left < definitions.length; left++) {
    for (let right = left + 1; right < definitions.length; right++) {
      const first = definitions[left]!;
      const second = definitions[right]!;
      if (
        compareRoutePatterns(first.pattern, second.pattern) === 0 &&
        routePatternsOverlap(first.pattern, second.pattern)
      ) {
        throw new TypeError(
          `Ambiguous routes '${first.id}' (${first.pattern}) and ` +
          `'${second.id}' (${second.pattern}) have equal specificity`,
        );
      }
    }
  }
}

function compilePattern(pattern: string): CompiledPattern {
  const normalized = validateRoutePattern(pattern);
  const cached = compiledPatterns.get(normalized);
  if (cached !== undefined) {
    compiledPatterns.delete(normalized);
    compiledPatterns.set(normalized, cached);
    return cached;
  }

  const keys: string[] = [];
  const segments = pathSegments(normalized);
  let body = '';

  for (const segment of segments) {
    if (segment === '*') {
      keys.push('*');
      body += '(?:/(.*))?';
      continue;
    }
    const param = PARAM_SEGMENT.exec(segment);
    if (param !== null) {
      keys.push(param[1]!);
      body += '/([^/]+)';
      continue;
    }
    body += `/${escapeRegExp(segment)}`;
  }

  if (segments.length === 0) body = '/';
  const source = body === '/' ? '' : body;
  const compiled: CompiledPattern = {
    pattern: normalized,
    keys,
    end: new RegExp(`^${source || '/'}/*$`),
    prefix: new RegExp(`^${source || ''}(?=/|$)`),
  };
  if (compiledPatterns.size >= PATTERN_CACHE_LIMIT) {
    const oldest = compiledPatterns.keys().next().value as string | undefined;
    if (oldest !== undefined) compiledPatterns.delete(oldest);
  }
  compiledPatterns.set(normalized, compiled);
  return compiled;
}

function decodePathValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function matchRoutePattern(
  pattern: string,
  pathname: string,
  options: MatchPatternOptions = {},
): PatternMatch | null {
  const compiled = compilePattern(pattern);
  const normalizedPathname = normalizeRoutePath(pathname);
  const match = (options.end ?? true ? compiled.end : compiled.prefix)
    .exec(normalizedPathname);
  if (match === null) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < compiled.keys.length; index++) {
    const value = match[index + 1];
    if (value !== undefined) {
      params[compiled.keys[index]!] = decodePathValue(value);
    }
  }

  const consumed = match[0] === '' ? '/' : match[0]!;
  const rest = normalizedPathname.slice(match[0]!.length);
  return {
    pattern: compiled.pattern,
    pathname: normalizedPathname,
    params: Object.freeze(params),
    consumed,
    remaining: rest === '' ? '/' : normalizeRoutePath(rest),
  };
}

function appendQueryValue(
  search: URLSearchParams,
  key: string,
  value: RouteQueryValue,
): void {
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(search, key, item);
    return;
  }
  if (value === null || value === undefined) return;
  search.append(key, String(value));
}

export function createRouteQuery(query: RouteQueryInput | undefined): string {
  if (query === undefined) return '';
  const search = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    appendQueryValue(search, key, query[key]);
  }
  const value = search.toString();
  return value === '' ? '' : `?${value}`;
}

export function buildRoutePath<Path extends string>(
  pattern: Path,
  params?: RouteParams<Path>,
  query?: RouteQueryInput,
  hash?: string,
): string {
  const supplied = params as Readonly<Record<string, RouteParamValue>> | undefined;
  const normalizedPattern = validateRoutePattern(pattern);
  const encodeSegment = (value: RouteParamValue, key: string): string => {
    const text = String(value);
    if (text === '.' || text === '..') {
      throw new TypeError(`Route parameter '${key}' must not be a dot segment`);
    }
    return encodeURIComponent(text);
  };
  let pathname = normalizedPattern.replace(
    /:([A-Za-z_$][A-Za-z0-9_$]*)/g,
    (_token, key: string) => {
      const value = supplied?.[key];
      if (value === undefined) {
        throw new TypeError(`Missing route parameter '${key}' for '${pattern}'`);
      }
      return encodeSegment(value, key);
    },
  );
  if (pathname.endsWith('/*')) {
    const value = supplied?.['*'];
    if (value === undefined) {
      throw new TypeError(`Missing route parameter '*' for '${pattern}'`);
    }
    const wildcard = String(value);
    const segments = wildcard.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw new TypeError(`Route wildcard '*' contains an invalid path segment`);
    }
    pathname = `${pathname.slice(0, -1)}${segments.map(segment =>
      encodeSegment(segment, '*')
    ).join('/')}`;
  }
  const normalizedHash = hash === undefined || hash === ''
    ? ''
    : hash.startsWith('#') ? hash : `#${hash}`;
  return `${pathname}${createRouteQuery(query)}${normalizedHash}`;
}

export function rankRoutePattern(pattern: string): number {
  let rank = 1;
  for (const segment of patternSegments(pattern)) {
    rank = rank * 4 + segmentKind(segment);
  }
  return rank;
}
