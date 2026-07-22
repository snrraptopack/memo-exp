/**
 * @file events.ts
 * M3 — Origin-aware handler wrapping + the event log.
 * M4 — commitWrites() extracted: programmatic ops (non-DOM-event sources like
 *      websocket messages, timers, or benchmark scenarios) route their
 *      write-sets through the exact same table as event handlers.
 *
 * handle() is what the M5 compiler wraps every user event handler in:
 *   1. run user code (plain assignments — no interception, no proxies)
 *   2. record provenance in the event log (origin, writes, timestamp)
 *   3. route the handler's STATIC write-set through the access table:
 *        - any opaque write -> root-subtree commit (Imba fallback)
 *        - otherwise        -> dirty exactly the resolved live readers
 *
 * The user never sees this. Their handler is a plain closure; the wrapper and
 * the write-set are compiler-generated.
 */

import { markDirty, markDirtySubtree, registeredIds, type EntityId } from './kernel';
import { resolveWrites, getRootId } from './access';

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
 * Route a write-set through the static access table and dirty the readers.
 * This is THE invalidation entry point — handlers and programmatic sources
 * share it, so there is exactly one routing code path in the runtime.
 */
export function commitWrites(writes: readonly string[], payload?: Record<string, any>): void {
  // registeredIds() is a cached array (zero per-event allocation) — do not spread it
  const resolved = resolveWrites(writes, registeredIds(), payload);
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
