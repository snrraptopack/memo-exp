/** Optional transfer consumer and hydration handoff on the existing fetch store. */
import {getActiveEnvironment} from '@memoized-dom/runtime';
import {RequestError, type RequestErrorKind} from './errors';
import {fetchTransferContract, fetchTransferIdentity} from './request-transfer';
import type {FetchStore, FetchRestoration} from './resource';
import {fetchStoreForRuntime, fetchRestorationForRuntime, installFetchTransferIdentity, type CoreDataRuntime} from './runtime-core';
import type {DataRuntime, SerializedDataState, SerializedSourceRecord, SerializedSourceSnapshot} from './types';
type FetchEntry = FetchStore['allEntries'] extends Set<infer Entry> ? Entry : never;

/**
 * Apply a restored record to a freshly acquired entry. Success restores as
 * committed (no duplicate request), error restores its local Error branch,
 * pending resumes after the hydration handoff (RFC §16.6.6–16.6.8).
 */
function seedEntryFromRecord(
  entry: FetchEntry,
  record: SerializedSourceRecord,
): void {
  const { snapshot } = record;
  if (snapshot.status === 'success') {
    entry.snapshot = {
      data: snapshot.data,
      error: null,
      status: 'success',
      pending: false,
      refreshing: snapshot.revalidate,
    };
    entry.hasData = true;
    return;
  }
  if (snapshot.status === 'error') {
    entry.snapshot = {
      data: undefined,
      error: new RequestError(snapshot.error.message, {
        kind: snapshot.error.kind as RequestErrorKind,
        status: snapshot.error.status ?? undefined,
        statusText: snapshot.error.statusText ?? undefined,
      }),
      status: 'error',
      pending: false,
      refreshing: false,
    };
    return;
  }
  entry.snapshot = {
    data: undefined,
    error: null,
    status: 'pending',
    pending: true,
    refreshing: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TRANSFER_ERROR_KINDS = new Set<RequestErrorKind>([
  'network',
  'http',
  'decode',
  'validation',
]);

function isSerializedSnapshot(value: unknown): value is SerializedSourceSnapshot {
  if (!isRecord(value)) return false;
  if (value.status === 'pending') return true;
  if (value.status === 'success') {
    return typeof value.revalidate === 'boolean' && Object.hasOwn(value, 'data');
  }
  if (value.status !== 'error' || !isRecord(value.error)) return false;
  return typeof value.error.kind === 'string' &&
    TRANSFER_ERROR_KINDS.has(value.error.kind as RequestErrorKind) &&
    (value.error.status === null || typeof value.error.status === 'number') &&
    (value.error.statusText === null || typeof value.error.statusText === 'string') &&
    typeof value.error.message === 'string';
}

function isSerializedSourceRecord(value: unknown): value is SerializedSourceRecord {
  if (!isRecord(value)) return false;
  return typeof value.sourceId === 'string' &&
    value.sourceId.length > 0 &&
    typeof value.contractId === 'string' &&
    value.contractId.startsWith('mmd-fetch/v1:') &&
    value.requestFingerprint === value.sourceId &&
    isSerializedSnapshot(value.snapshot);
}


class RestoredFetchStore implements FetchRestoration {
  private readonly restoreRecords = new Map<string, SerializedSourceRecord>();
  private readonly streamWaiters = new Map<string, Set<FetchEntry>>();
  private readonly retiredStreams = new Set<string>();
  private hydrationBlocked = false;
  private readonly deferredStarts = new Set<FetchEntry>();

  constructor(private readonly store: FetchStore) {}

  install(state: SerializedDataState): void {
    for (const record of this.records(state)) this.restoreRecords.set(record.sourceId, record);
  }

  private records(state: SerializedDataState): SerializedSourceRecord[] {
    if (!isRecord(state)) {
      throw new TypeError('Serialized data state must be an object');
    }
    const version: unknown = state.formatVersion;
    if (version !== 1) {
      throw new TypeError(
        `Unsupported serialized data state format: ${String(version)}`,
      );
    }
    const sources: unknown = state.sources;
    if (!Array.isArray(sources)) {
      throw new TypeError('Serialized data state sources must be an array');
    }
    return sources.filter(isSerializedSourceRecord);
  }

  deliverStreamedState(state: SerializedDataState): void {
    for (const record of this.records(state)) {
      if (record.snapshot.status === 'pending' || this.retiredStreams.has(record.sourceId)) continue;
      const waiters = this.streamWaiters.get(record.sourceId);
      if (waiters === undefined) {
        this.restoreRecords.set(record.sourceId, record);
        continue;
      }
      for (const entry of [...waiters]) {
        if (!this.store.allEntries.has(entry) || record.contractId !== fetchTransferContract(entry.descriptor.schema)) continue;
        waiters.delete(entry);
        seedEntryFromRecord(entry, record);
        entry.emit();
        if (record.snapshot.status === 'success' && record.snapshot.revalidate) entry.start(true).catch(() => {});
      }
      if (waiters.size === 0) {
        this.streamWaiters.delete(record.sourceId);
        this.restoreRecords.delete(record.sourceId);
        this.retiredStreams.add(record.sourceId);
      }
    }
  }

  endStream(): void {
    const waiting = [...this.streamWaiters.values()].flatMap(entries => [...entries]);
    for (const entry of waiting) {
      this.release(entry);
      if (!this.store.allEntries.has(entry) || entry.request !== null) continue;
      if (this.hydrationBlocked) {
        entry.deferStart();
        this.deferredStarts.add(entry);
      } else entry.start(true).catch(() => {});
    }
    for (const [identity, record] of this.restoreRecords) {
      if (record.snapshot.status === 'pending' && record.snapshot.streamed) {
        this.restoreRecords.set(identity, {...record, snapshot: {status: 'pending'}});
      }
    }
  }

  private takeRestoreRecord(
    identity: string | null,
    contractId: string,
  ): SerializedSourceRecord | undefined {
    if (identity === null) return undefined;
    const record = this.restoreRecords.get(identity);
    if (record === undefined || record.contractId !== contractId) return undefined;
    if (record.snapshot.status !== 'pending' || record.snapshot.streamed !== true) this.restoreRecords.delete(identity);
    return record;
  }

  start(entry: FetchEntry, force: boolean): void {
    const descriptor = entry.descriptor;
    const restored = this.takeRestoreRecord(
      descriptor.transferIdentity,
      fetchTransferContract(descriptor.schema),
    );
    const awaitingStream = restored?.snapshot.status === 'pending' && restored.snapshot.streamed === true;
    if (restored !== undefined) {
      seedEntryFromRecord(entry, restored);
      entry.emit();
      if (awaitingStream) {
        let waiters = this.streamWaiters.get(restored.sourceId);
        if (waiters === undefined) this.streamWaiters.set(restored.sourceId, waiters = new Set());
        waiters.add(entry);
      }
    }
    // A seeded entry resumes only through an explicit refresh — a restored
    // success must not re-issue its request (RFC §16.6.6) and a restored
    // error retries only through its restored source handle (§16.6.8).
    // Shell pending entries fetch after adoption. Streamed entries wait for
    // delivery or the end of parsing; explicit refresh takes ownership.
    const shouldStart =
      force ||
      (restored === undefined &&
        (entry.snapshot.status === 'idle' ||
          entry.snapshot.status === 'error')) ||
      (restored !== undefined &&
        ((restored.snapshot.status === 'pending' && !awaitingStream) ||
          (restored.snapshot.status === 'success' && restored.snapshot.revalidate)));
    if (getActiveEnvironment().mode === 'hydrate') {
      this.hydrationBlocked = true;
      if (shouldStart) {
        entry.deferStart();
        this.deferredStarts.add(entry);
      }
    } else if (shouldStart) {
      entry.start(force).catch(() => {});
    }
  }

  resumeHydration(): void {
    if (!this.hydrationBlocked) return;
    this.hydrationBlocked = false;
    for (const entry of [...this.deferredStarts]) {
      this.deferredStarts.delete(entry);
      if (entry.request === null) entry.start(true).catch(() => {});
    }
  }

  cancelHydration(): void {
    this.hydrationBlocked = false;
    for (const entry of [...this.deferredStarts]) {
      entry.cancelDeferredStart();
    }
  }

  release(entry: FetchEntry): void {
    this.deferredStarts.delete(entry);
    for (const [identity, waiters] of this.streamWaiters) {
      if (waiters.delete(entry) && waiters.size === 0) {
        this.streamWaiters.delete(identity);
        this.restoreRecords.delete(identity);
        this.retiredStreams.add(identity);
      }
    }
  }
  clear(): void {
    this.restoreRecords.clear();
    this.streamWaiters.clear();
    this.retiredStreams.clear();
    this.deferredStarts.clear();
    this.hydrationBlocked = false;
  }
}

/** Public or SSR delivery enables transfer on the same runtime/cache boundary. */
export function enableDataRestoration<T extends CoreDataRuntime>(runtime: T): T & Pick<DataRuntime, 'restoreState'> {
  if ('restoreState' in runtime) return runtime as T & Pick<DataRuntime, 'restoreState'>;
  installFetchTransferIdentity(runtime, fetchTransferIdentity);
  const store = fetchStoreForRuntime(runtime);
  const restoration = new RestoredFetchStore(store);
  store.restoration = restoration;
  return Object.assign(runtime, {restoreState(state: SerializedDataState) { restoration.install(state); }});
}
export function resumeDataHydration(runtime: CoreDataRuntime): void {
  fetchRestorationForRuntime(runtime)?.resumeHydration();
}
export function cancelDataHydration(runtime: CoreDataRuntime): void {
  fetchRestorationForRuntime(runtime)?.cancelHydration();
}

export function deliverStreamedDataState(runtime: CoreDataRuntime, state: SerializedDataState): void {
  fetchRestorationForRuntime(runtime)?.deliverStreamedState(state);
}

export function endDataStream(runtime: CoreDataRuntime): void {
  fetchRestorationForRuntime(runtime)?.endStream();
}
