/** Optional data transfer producer; browser restoration stays in FetchStore. */
import { fetchTransferContract } from './request';
import type { FetchStore } from './resource';
import { fetchStoreForRuntime, type CoreDataRuntime } from './runtime-core';
import type { DataRuntime, SerializedSourceRecord, SerializedSourceSnapshot } from './types';

type FetchEntry = FetchStore['allEntries'] extends Set<infer Entry> ? Entry : never;

/** Transfer values must be plain JSON data; do not invoke authored getters. */
function isJsonTransferValue(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 100 || ancestors.has(value)) return false;
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (array && (
      keys.length !== value.length + 1 ||
      keys.some((key, index) => index < value.length && key !== String(index))
    )) return false;
    ancestors.add(value);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') return false;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (property === undefined || !('value' in property) ||
        !isJsonTransferValue(property.value, ancestors, depth + 1)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
}

/** Omit idle entries and payloads that cannot be transferred without loss. */
function serializeEntry(entry: FetchEntry): SerializedSourceRecord | undefined {
  const transferIdentity = entry.descriptor.transferIdentity;
  if (transferIdentity === null) return undefined;
  const { snapshot } = entry;
  let serialized: SerializedSourceSnapshot;
  if (snapshot.status === 'success') {
    if (!isJsonTransferValue(snapshot.data)) return undefined;
    serialized = {
      status: 'success',
      data: snapshot.data,
      revalidate: snapshot.refreshing,
    };
  } else if (snapshot.status === 'error') {
    const error = snapshot.error;
    serialized = {
      status: 'error',
      error: {
        kind: error?.kind ?? 'network',
        status: error?.status ?? null,
        statusText: error?.statusText ?? null,
        message: 'Request failed',
      },
    };
  } else if (snapshot.pending) {
    serialized = { status: 'pending' };
  } else {
    return undefined;
  }
  return {
    sourceId: transferIdentity,
    contractId: fetchTransferContract(entry.descriptor.schema),
    requestFingerprint: transferIdentity,
    snapshot: serialized,
  };
}


/** Public runtimes expose serialization on their existing ownership boundary. */
export function enableDataSerialization<T extends CoreDataRuntime>(
  runtime: T,
): T & Pick<DataRuntime, 'serializeState'> {
  if ('serializeState' in runtime) return runtime as T & Pick<DataRuntime, 'serializeState'>;
  return Object.assign(runtime, {
    serializeState() {
      const sources: SerializedSourceRecord[] = [];
      for (const entry of fetchStoreForRuntime(runtime).allEntries) {
        if (entry.consumers.size === 0) continue;
        const record = serializeEntry(entry);
        if (record !== undefined) sources.push(record);
      }
      return { formatVersion: 1 as const, sources };
    },
  });
}
