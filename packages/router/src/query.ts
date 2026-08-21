/**
 * @fileoverview High-performance query-string serialization and parsing for @memoized-dom/router.
 *
 * Designed for extreme hotpath throughput:
 * - Bypasses Web IDL URLSearchParams host object allocation.
 * - Single-pass key-value string concatenation and zero-alloc scanning.
 * - Small-array sorting networks (3-key and 4-key) avoiding Array.prototype.sort() engine overhead.
 * - Reference memoization and unreserved character fast paths.
 * - Conforms to standard application/x-www-form-urlencoded specifications.
 */

import type { ParsedRouteQuery, RouteParamValue, RouteQueryInput } from './types';

/**
 * Fast check if a string contains only unreserved URL query characters:
 * a-z (97-122), A-Z (65-90), 0-9 (48-57), '-' (45), '_' (95), '.' (46), '~' (126).
 */
function isCleanQueryString(str: string): boolean {
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const c = str.charCodeAt(i);
    if (
      (c >= 97 && c <= 122) ||
      (c >= 65 && c <= 90) ||
      (c >= 48 && c <= 57) ||
      c === 45 ||
      c === 95 ||
      c === 46 ||
      c === 126
    ) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Encodes a query value into a URL-safe string representation,
 * encoding spaces as '+' conforming to standard URL query syntax.
 */
export function encodeQueryValue(value: RouteParamValue | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (value === true) return 'true';
  if (value === false) return 'false';
  const str = String(value);
  if (str === '') return '';
  if (isCleanQueryString(str)) return str;
  return encodeURIComponent(str).replace(/%20/g, '+');
}

/**
 * Encodes a query key into a URL-safe string representation.
 */
export function encodeQueryKey(key: string): string {
  if (isCleanQueryString(key)) return key;
  return encodeURIComponent(key).replace(/%20/g, '+');
}

/**
 * Decodes a query string component, replacing '+' with spaces.
 * Fast-paths clean strings without % or + in 1 CPU cycle.
 */
function decodeQueryComponent(value: string): string {
  if (!value.includes('%') && !value.includes('+')) return value;
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

const EMPTY_PARSED_QUERY: ParsedRouteQuery = Object.freeze(Object.create(null));
let lastDecodeInput = '';
let lastDecodeResult: ParsedRouteQuery = EMPTY_PARSED_QUERY;

/**
 * Parses a query string into a key-value dictionary without instantiating URLSearchParams.
 *
 * Supports scalar values, repeated keys into arrays, and reference memoization.
 */
export function parseRouteQuery(search: string): ParsedRouteQuery {
  if (!search || search === '?' || search === '') return EMPTY_PARSED_QUERY;
  if (search === lastDecodeInput) return lastDecodeResult;

  const query: Record<string, string | string[]> = Object.create(null);
  const start = search.charCodeAt(0) === 63 /* '?' */ ? 1 : 0;
  const len = search.length;

  let keyStart = start;
  let valStart = -1;
  let hasKeySpecial = false;
  let hasValSpecial = false;

  for (let i = start; i <= len; i++) {
    const isEnd = i === len;
    const c = isEnd ? 38 /* '&' */ : search.charCodeAt(i);

    if (c === 61 /* '=' */ && valStart === -1) {
      valStart = i + 1;
    } else if (c === 38 /* '&' */) {
      if (i > keyStart) {
        let key: string;
        let val: string;

        if (valStart === -1) {
          const rawKey = search.slice(keyStart, i);
          key = hasKeySpecial ? decodeQueryComponent(rawKey) : rawKey;
          val = '';
        } else {
          const rawKey = search.slice(keyStart, valStart - 1);
          const rawVal = search.slice(valStart, i);
          key = hasKeySpecial ? decodeQueryComponent(rawKey) : rawKey;
          val = hasValSpecial ? decodeQueryComponent(rawVal) : rawVal;
        }

        const existing = query[key];
        if (existing === undefined) {
          query[key] = val;
        } else if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          query[key] = [existing, val];
        }
      }
      keyStart = i + 1;
      valStart = -1;
      hasKeySpecial = false;
      hasValSpecial = false;
    } else if (c === 37 /* '%' */ || c === 43 /* '+' */) {
      if (valStart === -1) {
        hasKeySpecial = true;
      } else {
        hasValSpecial = true;
      }
    }
  }

  for (const key of Object.keys(query)) {
    const value = query[key];
    if (Array.isArray(value)) Object.freeze(value);
  }
  const frozen: ParsedRouteQuery = Object.freeze(query);
  lastDecodeInput = search;
  lastDecodeResult = frozen;
  return frozen;
}

/**
 * 3-element in-place sorting network (at most 3 comparisons).
 */
function sort3(arr: string[]): void {
  if (arr[0]! > arr[1]!) { const t = arr[0]!; arr[0] = arr[1]!; arr[1] = t; }
  if (arr[1]! > arr[2]!) { const t = arr[1]!; arr[1] = arr[2]!; arr[2] = t; }
  if (arr[0]! > arr[1]!) { const t = arr[0]!; arr[0] = arr[1]!; arr[1] = t; }
}

/**
 * 4-element in-place sorting network (at most 5 comparisons).
 */
function sort4(arr: string[]): void {
  if (arr[0]! > arr[1]!) { const t = arr[0]!; arr[0] = arr[1]!; arr[1] = t; }
  if (arr[2]! > arr[3]!) { const t = arr[2]!; arr[2] = arr[3]!; arr[3] = t; }
  if (arr[0]! > arr[2]!) { const t = arr[0]!; arr[0] = arr[2]!; arr[2] = t; }
  if (arr[1]! > arr[3]!) { const t = arr[1]!; arr[1] = arr[3]!; arr[3] = t; }
  if (arr[1]! > arr[2]!) { const t = arr[1]!; arr[1] = arr[2]!; arr[2] = t; }
}

/**
 * In-place insertion sort for small arrays (5-8 elements).
 */
function insertionSort(arr: string[]): void {
  const len = arr.length;
  for (let i = 1; i < len; i++) {
    const key = arr[i]!;
    let j = i - 1;
    while (j >= 0 && arr[j]! > key) {
      arr[j + 1] = arr[j]!;
      j--;
    }
    arr[j + 1] = key;
  }
}

let lastEncodeQuery: RouteQueryInput | undefined;
let lastEncodeResult = '';

/** Reference memoization is safe only for runtime-immutable input graphs. */
export function isMemoizableRouteQuery(
  query: RouteQueryInput | undefined,
): boolean {
  if (query === undefined) return true;
  if (!Object.isFrozen(query)) return false;
  for (const value of Object.values(query)) {
    if (Array.isArray(value) && !Object.isFrozen(value)) return false;
  }
  return true;
}

/**
 * Serializes a key-value dictionary into a deterministic URL query string.
 *
 * Features:
 * - Reference memoization for identical query dictionaries.
 * - Single-pass key-value string concatenation without URLSearchParams.
 * - In-place small-array sorting networks for deterministic URL keys.
 * - Array values produce repeated keys: `?tag=alpha&tag=beta`.
 * - Null and undefined values are omitted.
 */
export function createRouteQuery(query: RouteQueryInput | undefined): string {
  if (query === undefined) return '';
  const memoizable = isMemoizableRouteQuery(query);
  if (memoizable && query === lastEncodeQuery) return lastEncodeResult;

  const record = query as Record<string, unknown>;
  const keys = Object.keys(record);
  const len = keys.length;
  if (len === 0) return '';

  let out = '';

  // Fast single-key path
  if (len === 1) {
    const key = keys[0]!;
    const val = record[key];
    if (val === null || val === undefined) return '';

    const encKey = isCleanQueryString(key) ? key : encodeQueryKey(key);
    if (!Array.isArray(val)) {
      out = `?${encKey}=${encodeQueryValue(val as RouteParamValue)}`;
    } else if (val.length > 0) {
      for (let i = 0; i < val.length; i++) {
        const item = val[i];
        if (item === null || item === undefined) continue;
        out += (out === '' ? '?' : '&') + encKey + '=' + encodeQueryValue(item as RouteParamValue);
      }
    }
    if (memoizable) {
      lastEncodeQuery = query;
      lastEncodeResult = out;
    }
    return out;
  }

  // Fast 2-key path (comparator without Array#sort allocation)
  if (len === 2) {
    const k0 = keys[0]!;
    const k1 = keys[1]!;
    const firstKey = k0 < k1 ? k0 : k1;
    const secondKey = k0 < k1 ? k1 : k0;
    const v0 = record[firstKey];
    const v1 = record[secondKey];

    if (!Array.isArray(v0) && !Array.isArray(v1)) {
      if (v0 != null && v1 != null) {
        const ek0 = isCleanQueryString(firstKey) ? firstKey : encodeQueryKey(firstKey);
        const ek1 = isCleanQueryString(secondKey) ? secondKey : encodeQueryKey(secondKey);
        out = `?${ek0}=${encodeQueryValue(v0 as RouteParamValue)}&${ek1}=${encodeQueryValue(v1 as RouteParamValue)}`;
        if (memoizable) {
          lastEncodeQuery = query;
          lastEncodeResult = out;
        }
        return out;
      }
    }

    const orderedKeys = [firstKey, secondKey];
    for (let i = 0; i < 2; i++) {
      const key = orderedKeys[i]!;
      const val = record[key];
      if (val === null || val === undefined) continue;

      const encKey = isCleanQueryString(key) ? key : encodeQueryKey(key);
      if (Array.isArray(val)) {
        for (let j = 0; j < val.length; j++) {
          const item = val[j];
          if (item === null || item === undefined) continue;
          out += (out === '' ? '?' : '&') + encKey + '=' + encodeQueryValue(item as RouteParamValue);
        }
      } else {
        out += (out === '' ? '?' : '&') + encKey + '=' + encodeQueryValue(val as RouteParamValue);
      }
    }
    if (memoizable) {
      lastEncodeQuery = query;
      lastEncodeResult = out;
    }
    return out;
  }

  // Small-array sorting networks for deterministic 3-8 key dictionaries
  if (len === 3) {
    sort3(keys);
  } else if (len === 4) {
    sort4(keys);
  } else if (len <= 8) {
    insertionSort(keys);
  } else {
    keys.sort();
  }

  for (let i = 0; i < len; i++) {
    const key = keys[i]!;
    const val = record[key];
    if (val === null || val === undefined) continue;

    const encKey = isCleanQueryString(key) ? key : encodeQueryKey(key);
    if (Array.isArray(val)) {
      for (let j = 0; j < val.length; j++) {
        const item = val[j];
        if (item === null || item === undefined) continue;
        out += (out === '' ? '?' : '&') + encKey + '=' + encodeQueryValue(item as RouteParamValue);
      }
    } else {
      out += (out === '' ? '?' : '&') + encKey + '=' + encodeQueryValue(val as RouteParamValue);
    }
  }

  if (memoizable) {
    lastEncodeQuery = query;
    lastEncodeResult = out;
  }
  return out;
}
