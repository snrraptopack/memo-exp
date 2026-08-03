import { RequestError } from './errors';
import { validateValue } from './schema';
import type {
  Query,
  RequestKey,
  StandardSchemaV1,
} from './types';

const schemaIds = new WeakMap<object, number>();
let nextSchemaId = 1;

function schemaId(schema: StandardSchemaV1 | undefined): string {
  if (schema === undefined) return 'none';
  let id = schemaIds.get(schema);
  if (id === undefined) {
    id = nextSchemaId++;
    schemaIds.set(schema, id);
  }
  return String(id);
}

function appendQuery(url: string, query: Query | undefined): string {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const parameters = new URLSearchParams(
    queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1),
  );

  if (query !== undefined) {
    for (const key of Object.keys(query).sort()) {
      const value = query[key];
      if (value === undefined) continue;
      parameters.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) parameters.append(key, String(item));
      } else {
        parameters.append(key, String(value));
      }
    }
  }

  parameters.sort();
  const serialized = parameters.toString();
  return `${path}${serialized === '' ? '' : `?${serialized}`}${hash}`;
}

export function resolveRequestURL(
  target: string | URL,
  query: Query | undefined,
  baseURL: string | URL | undefined,
): string {
  const raw = target instanceof URL ? target.href : target;
  const resolved = baseURL === undefined ? raw : new URL(raw, baseURL).href;
  return appendQuery(resolved, query);
}

function normalizedHeaders(headers: HeadersInit | undefined): string {
  const normalized = new Headers(headers);
  return [...normalized.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function explicitKey(key: RequestKey): string {
  const parts = typeof key === 'string' ? [key] : key;
  return parts
    .map(part => `${typeof part}:${encodeURIComponent(String(part))}`)
    .join('|');
}

export function fetchIdentity(
  url: string,
  headers: HeadersInit | undefined,
  key: RequestKey | undefined,
  schema: StandardSchemaV1 | undefined,
): string {
  if (key !== undefined) return `explicit|${explicitKey(key)}`;
  return `GET|${url}|${normalizedHeaders(headers)}|schema:${schemaId(schema)}`;
}

export async function decodeResponse(
  response: Response,
  schema: StandardSchemaV1 | undefined,
): Promise<unknown> {
  let data: unknown;
  try {
    if (response.status === 204 || response.status === 205) {
      data = undefined;
    } else {
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      data = contentType.includes('json')
        ? await response.json()
        : await response.text();
    }
  } catch (cause) {
    throw new RequestError('Failed to decode response', {
      kind: 'decode',
      status: response.status,
      statusText: response.statusText,
      cause,
    });
  }

  if (!response.ok) {
    throw new RequestError(
      `Request failed with status ${response.status}`,
      {
        kind: 'http',
        status: response.status,
        statusText: response.statusText,
        data,
      },
    );
  }

  return schema === undefined ? data : validateValue(schema, data);
}

export function encodeActionBody(
  input: unknown,
  headers: Headers,
): BodyInit | undefined {
  if (input === undefined) return undefined;
  if (
    typeof input === 'string' ||
    input instanceof Blob ||
    input instanceof FormData ||
    input instanceof URLSearchParams ||
    input instanceof ArrayBuffer ||
    ArrayBuffer.isView(input)
  ) {
    return input as BodyInit;
  }

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return JSON.stringify(input);
}
