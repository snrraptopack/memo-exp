import type {
  MatchPatternOptions,
  PatternMatch,
  RouteParamValue,
  RouteParams,
  RouteQueryInput,
  RouteQueryValue,
} from './types';

const PARAM_SEGMENT = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;
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

export function normalizeRoutePath(path: string): string {
  const [pathname = ''] = path.split(/[?#]/, 1);
  const normalized = `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '' ? '/' : normalized;
}

export function joinRoutePaths(parent: string, child: string): string {
  const base = normalizeRoutePath(parent);
  const nested = normalizeRoutePath(child);
  if (nested === '/') return base;
  if (base === '/') return nested;
  return `${base}${nested}`;
}

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeRoutePath(pattern);
  const cached = compiledPatterns.get(normalized);
  if (cached !== undefined) return cached;

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
  const pathname = normalizeRoutePath(pattern).replace(
    /:([A-Za-z_$][A-Za-z0-9_$]*)/g,
    (_token, key: string) => {
      const value = supplied?.[key];
      if (value === undefined) {
        throw new TypeError(`Missing route parameter '${key}' for '${pattern}'`);
      }
      return encodeURIComponent(String(value));
    },
  );
  const normalizedHash = hash === undefined || hash === ''
    ? ''
    : hash.startsWith('#') ? hash : `#${hash}`;
  return `${pathname}${createRouteQuery(query)}${normalizedHash}`;
}

export function rankRoutePattern(pattern: string): number {
  let rank = 0;
  for (const segment of pathSegments(normalizeRoutePath(pattern))) {
    if (segment === '*') rank += 1;
    else if (PARAM_SEGMENT.test(segment)) rank += 10;
    else rank += 100;
  }
  return rank;
}
