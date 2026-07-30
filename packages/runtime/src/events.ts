/**
 * @file events.ts
 * M3 — Origin-aware handler wrapping + the event log.
 * M4 — commitWrites() extracted: programmatic ops (non-DOM-event sources like
 *      websocket messages, timers, or benchmark scenarios) route their
 *      effects through the exact same table as event handlers.
 *
 * handle() is the optional provenance-recording event boundary:
 *   1. run user code (plain assignments — no interception, no proxies)
 *   2. record provenance in the event log (origin, writes, timestamp)
 *   3. route the handler's static exact/bounded effects through the access
 *      table; a table-level unbounded result selects the root subtree.
 *
 * The user never sees this. Their handler is a plain closure; the wrapper and
 * the write-set are compiler-generated.
 */

import { markDirty, markDirtySubtree, type EntityId } from './kernel';
import { resolveStaticWrites, resolveWrites, getRootId } from './access';

export interface EventRecord {
  origin: EntityId;
  writes: readonly string[];
  at: number;
}

const LOG_CAP = 1000;
const eventLog: EventRecord[] = [];

/** Provenance for every routed event — devtools, tests, debugging. */
export function getEventLog(): readonly EventRecord[] {
  return eventLog;
}

export function clearEventLog(): void {
  eventLog.length = 0;
}

/**
 * Route exact or bounded effects through the static access table and dirty
 * their readers.
 * This is THE invalidation entry point — handlers and programmatic sources
 * share it, so there is exactly one routing code path in the runtime.
 */
export function commitWrites(writes: readonly string[]): void {
  const resolved = resolveStaticWrites(writes);
  if (resolved === 'root-subtree') {
    markDirtySubtree(getRootId());
    return;
  }
  for (const id of resolved) markDirty(id);
}

/** Route an L2 payload through parameterized access patterns. */
export function commitWritesWithPayload(
  writes: readonly string[],
  payload: Record<string, any>,
): void {
  const resolved = resolveWrites(writes, [], payload);
  if (resolved === 'root-subtree') {
    markDirtySubtree(getRootId());
    return;
  }
  for (const id of resolved) markDirty(id);
}

export function handle<T extends Event>(
  origin: EntityId,
  writes: readonly string[],
  fn: (ev: T) => void,
): (ev: T) => void {
  return (ev: T) => {
    fn(ev);

    eventLog.push({ origin, writes, at: Date.now() });
    if (eventLog.length > LOG_CAP) eventLog.shift();

    commitWrites(writes);
  };
}
