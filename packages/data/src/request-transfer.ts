/** Transfer fingerprints are installed only by serialization or restoration. */
import { textIdentity } from './request-hash';
import type { FetchMethod, RequestKey, StandardSchemaV1 } from './types';

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
    // Generated GET functions transfer by the complete evaluated request.
    // Ordinary query-bearing fetches retain the conservative transfer policy.
    if (parsed.search !== '' && !parsed.pathname.startsWith('/_fn/')) return null;
    const path = parsed.pathname === '' ? '/' : parsed.pathname;
    const absolute = target instanceof URL || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target);
    return absolute ? `${parsed.origin}${path}${parsed.search}` : `${path}${parsed.search}`;
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
  if (key !== undefined || (method !== 'GET' && method !== 'HEAD') ||
      [...headers].length > 0 || bodyIdentity !== 'none') return null;
  const transferTarget = transferableTarget(target, url);
  return transferTarget === null ? null : textIdentity(
    'transfer', `${method}|target:${transferTarget}|${contract}`,
  );
}
