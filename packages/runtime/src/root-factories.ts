/** Build metadata is realm-wide; application state remains runtime-owned. */
const rootFactoriesKey = Symbol.for('memoized-dom:root-factories');

/** Hosts share this registry without importing browser mount or DOM helpers. */
export function rootFactoryStore<Definition, Key extends object = object>(): WeakMap<Key, Definition> {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = realm[rootFactoriesKey];

  if (existing instanceof WeakMap) {
    return existing as WeakMap<Key, Definition>;
  }

  const created = new WeakMap<Key, Definition>();
  realm[rootFactoriesKey] = created;

  return created;
}
