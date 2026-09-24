import { isAbortError, RequestError } from './errors';
import { validateValue } from './schema';
import type {
  FetchMethod,
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
  return `${path}${serialized === '' ? '' : `?${serialized}`}`;
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
  method: FetchMethod,
  headers: HeadersInit | undefined,
  bodyIdentity: string,
  key: RequestKey | undefined,
  schema: StandardSchemaV1 | undefined,
): string {
  if (key !== undefined) {
    const keyed = `${method}|explicit:${explicitKey(key)}`;
    return method === 'GET' || method === 'HEAD'
      ? keyed
      : `${keyed}|body:${bodyIdentity}`;
  }
  return `${method}|${url}|${normalizedHeaders(headers)}|body:${bodyIdentity}|schema:${schemaId(schema)}`;
}

export function fetchTransferContract(schema: StandardSchemaV1 | undefined): string {
  if (schema === undefined) return 'mmd-fetch/v1:raw';
  const standard = schema['~standard'];
  const validator = textIdentity('schema', standard.validate.toString());
  return `mmd-fetch/v1:validated:${standard.vendor}:${validator}`;
}

function transferableTarget(target: string | URL, url: string): string | null {
  try {
    const parsed = new URL(url, 'http://memoized-dom.invalid');
    if (parsed.username !== '' || parsed.password !== '') return null;
    // Query parameter names cannot establish that their values are public.
    // A caller with a safe application-level identity can opt in explicitly.
    if (parsed.search !== '') return null;
    const path = parsed.pathname === '' ? '/' : parsed.pathname;
    const absolute = target instanceof URL || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target);
    return absolute ? `${parsed.origin}${path}` : path;
  } catch {
    return null;
  }
}

export function fetchTransferIdentity(
  target: string | URL,
  url: string,
  method: FetchMethod,
  headers: Headers,
  bodyIdentity: string,
  key: RequestKey | undefined,
  schema: StandardSchemaV1 | undefined,
): string | null {
  const contract = fetchTransferContract(schema);
  if (
    key !== undefined ||
    (method !== 'GET' && method !== 'HEAD') ||
    [...headers].length > 0 ||
    bodyIdentity !== 'none'
  ) return null;
  const transferTarget = transferableTarget(target, url);
  return transferTarget === null ? null : textIdentity(
    'transfer',
    `${method}|target:${transferTarget}|${contract}`,
  );
}

export function normalizeFetchMethod(method: FetchMethod | undefined): FetchMethod {
  const normalized = (method ?? 'GET').toUpperCase();
  if (
    normalized !== 'GET' &&
    normalized !== 'POST' &&
    normalized !== 'PUT' &&
    normalized !== 'PATCH' &&
    normalized !== 'DELETE' &&
    normalized !== 'HEAD' &&
    normalized !== 'OPTIONS'
  ) {
    throw new TypeError(`Unsupported $fetch method '${String(method)}'`);
  }
  return normalized;
}

const opaqueBodyIds = new WeakMap<object, number>();
let nextOpaqueBodyId = 1;

function opaqueBodyIdentity(body: object): string {
  let id = opaqueBodyIds.get(body);
  if (id === undefined) {
    id = nextOpaqueBodyId++;
    opaqueBodyIds.set(body, id);
  }
  return `opaque:${id}`;
}

interface IdentityHash {
  left: number;
  right: number;
  length: number;
}

function createIdentityHash(): IdentityHash {
  return { left: 0x811c9dc5, right: 0x9e3779b9, length: 0 };
}

function updateIdentityHash(hash: IdentityHash, value: number): void {
  hash.left = Math.imul(hash.left ^ value, 0x01000193);
  hash.right = Math.imul(hash.right ^ value, 0x85ebca6b) + 0xc2b2ae35;
  hash.length++;
}

function updateTextHash(hash: IdentityHash, value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    updateIdentityHash(hash, unit & 0xff);
    updateIdentityHash(hash, unit >>> 8);
  }
}

function finishIdentityHash(kind: string, hash: IdentityHash): string {
  return `${kind}:${hash.length}:${(hash.left >>> 0).toString(36)}:${(hash.right >>> 0).toString(36)}`;
}

function textIdentity(kind: string, value: string): string {
  const hash = createIdentityHash();
  updateTextHash(hash, value);
  return finishIdentityHash(kind, hash);
}

function bytesIdentity(bytes: Uint8Array): string {
  const hash = createIdentityHash();
  for (const byte of bytes) updateIdentityHash(hash, byte);
  return finishIdentityHash('bytes', hash);
}

export interface PreparedRequestBody {
  readonly body: BodyInit | undefined;
  readonly identity: string;
}

function cloneFormData(input: FormData): PreparedRequestBody {
  const body = new FormData();
  const hash = createIdentityHash();
  for (const [key, value] of input) {
    updateTextHash(hash, `${key.length}:`);
    updateTextHash(hash, key);
    if (typeof value === 'string') {
      body.append(key, value);
      updateTextHash(hash, `=text:${value.length}:`);
      updateTextHash(hash, value);
    } else {
      body.append(key, value, value.name);
      updateTextHash(hash, `=file:${opaqueBodyIdentity(value)}`);
    }
    updateTextHash(hash, ';');
  }
  const identity = finishIdentityHash('form', hash);
  return { body, identity };
}

/** Snapshot a replayable body and its synchronous request-key material. */
export function prepareRequestBody(
  input: unknown,
  headers: Headers,
): PreparedRequestBody {
  if (input === undefined) {
    return { body: undefined, identity: 'none' };
  }
  if (typeof input === 'string') {
    const identity = textIdentity('text', input);
    return { body: input, identity };
  }
  if (input instanceof URLSearchParams) {
    const body = new URLSearchParams(input);
    const identity = textIdentity('params', body.toString());
    return { body, identity };
  }
  if (input instanceof Blob) {
    return { body: input, identity: opaqueBodyIdentity(input) };
  }
  if (input instanceof FormData) {
    return cloneFormData(input);
  }
  if (input instanceof ArrayBuffer) {
    const bytes = new Uint8Array(input.slice(0));
    const identity = bytesIdentity(bytes);
    return { body: bytes, identity };
  }
  if (ArrayBuffer.isView(input)) {
    const body = new Uint8Array(
      input.buffer,
      input.byteOffset,
      input.byteLength,
    ).slice();
    const identity = bytesIdentity(body);
    return { body, identity };
  }

  const json = JSON.stringify(input);
  if (json === undefined) {
    throw new TypeError('Request body must be JSON-serializable');
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const identity = textIdentity('json', json);
  return { body: json, identity };
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
    if (isAbortError(cause)) throw cause;
    if (!response.ok) {
      throw new RequestError(
        `Request failed with status ${response.status}`,
        {
          kind: 'http',
          status: response.status,
          statusText: response.statusText,
          cause,
        },
      );
    }
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

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

/** Reject client interest immediately even when a custom fetcher ignores signals. */
export function abortable<T>(
  operation: () => PromiseLike<T> | T,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    try {
      Promise.resolve(operation())
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', abort);
        });
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

export function encodeRequestBody(
  input: unknown,
  headers: Headers,
): BodyInit | undefined {
  return prepareRequestBody(input, headers).body;
}
