export interface StaticTable {
  readers: Record<string, string[]>;
}

export interface RoutingKernel {
  mount(id: string, keys: readonly string[]): void;
  unmount(id: string, keys: readonly string[]): void;
  route(writes: readonly string[]): string[];
  retainedUnits(): Record<string, number>;
}

export class StaticIndexKernel implements RoutingKernel {
  private readonly exact = new Map<string, string[]>();
  private readonly wild = new Map<string, RegExp[]>();
  private readonly matched = new Map<string, Set<string>>();
  private readonly allKeys: string[];
  private readonly matchCache = new Map<string, string[]>();

  constructor(table: StaticTable) {
    for (const [key, patterns] of Object.entries(table.readers)) {
      for (const pattern of patterns) {
        if (!pattern.includes('*')) {
          const entries = this.exact.get(key) ?? [];
          entries.push(pattern);
          this.exact.set(key, entries);
          continue;
        }
        const entries = this.wild.get(key) ?? [];
        entries.push(compilePattern(pattern));
        this.wild.set(key, entries);
      }
    }
    for (const key of this.wild.keys()) this.matched.set(key, new Set());
    this.allKeys = [...new Set([...this.exact.keys(), ...this.wild.keys()])];
  }

  mount(id: string): void {
    for (const [key, patterns] of this.wild) {
      if (patterns.some((pattern) => pattern.test(id))) this.matched.get(key)!.add(id);
    }
  }

  unmount(id: string): void {
    for (const matches of this.matched.values()) matches.delete(id);
  }

  route(writes: readonly string[]): string[] {
    const out = new Set<string>();
    for (const write of writes) {
      for (const key of matchingKeys(write, this.allKeys, this.matchCache)) {
        for (const reader of this.exact.get(key) ?? []) out.add(reader);
        for (const reader of this.matched.get(key) ?? []) out.add(reader);
      }
    }
    return [...out];
  }

  retainedUnits(): Record<string, number> {
    return {
      exactEdges: sumSizes(this.exact.values()),
      wildcardPatterns: sumSizes(this.wild.values()),
      materializedWildcardEdges: sumSizes(this.matched.values()),
      subscriptionEdges: 0,
    };
  }
}

export class DynamicSubscriptionKernel implements RoutingKernel {
  private readonly subscribers = new Map<string, Set<string>>();
  private readonly matchCache = new Map<string, string[]>();
  private readonly allKeys: string[];

  constructor(keys: readonly string[]) {
    for (const key of keys) this.subscribers.set(key, new Set());
    this.allKeys = [...keys];
  }

  mount(id: string, keys: readonly string[]): void {
    for (const key of keys) this.subscribers.get(key)!.add(id);
  }

  unmount(id: string, keys: readonly string[]): void {
    for (const key of keys) this.subscribers.get(key)!.delete(id);
  }

  route(writes: readonly string[]): string[] {
    const out = new Set<string>();
    for (const write of writes) {
      for (const key of matchingKeys(write, this.allKeys, this.matchCache)) {
        for (const subscriber of this.subscribers.get(key) ?? []) out.add(subscriber);
      }
    }
    return [...out];
  }

  retainedUnits(): Record<string, number> {
    return {
      exactEdges: 0,
      wildcardPatterns: 0,
      materializedWildcardEdges: 0,
      subscriptionEdges: sumSizes(this.subscribers.values()),
    };
  }
}

function compilePattern(raw: string): RegExp {
  const escaped = raw
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

function pathsTouch(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function matchingKeys(
  write: string,
  allKeys: readonly string[],
  cache: Map<string, string[]>,
): string[] {
  let keys = cache.get(write);
  if (keys === undefined) {
    keys = allKeys.filter((key) => pathsTouch(key, write));
    cache.set(write, keys);
  }
  return keys;
}

function sumSizes(values: Iterable<{ size?: number; length?: number }>): number {
  let sum = 0;
  for (const value of values) sum += value.size ?? value.length ?? 0;
  return sum;
}
