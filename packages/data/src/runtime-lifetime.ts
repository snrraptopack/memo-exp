/** One lifetime and settlement coordinator for the providers used by a runtime. */
export interface DataRuntimeProvider {
  readonly settleTimeoutMs: number;
  pending(): Iterable<Promise<unknown>>;
  clear(): void;
}

interface Lifetime {
  providers: Set<DataRuntimeProvider>;
  disposers: Set<() => void>;
}

const lifetimes = new WeakMap<object, Lifetime>();

function lifetime(runtime: object): Lifetime {
  let current = lifetimes.get(runtime);
  if (current === undefined) {
    current = { providers: new Set(), disposers: new Set() };
    lifetimes.set(runtime, current);
  }
  return current;
}

export function registerDataRuntimeProvider(runtime: object, provider: DataRuntimeProvider): void {
  lifetime(runtime).providers.add(provider);
}

export function registerDataRuntimeDisposer(runtime: object, dispose: () => void): void {
  lifetime(runtime).disposers.add(dispose);
}

export function clearDataRuntimeSources(runtime: object): void {
  const current = lifetime(runtime);
  // Include a provider installed by a cancellation callback during clearing.
  for (const provider of current.providers) provider.clear();
  for (const dispose of current.disposers) dispose();
  current.disposers.clear();
}

export async function settleDataRuntimeSources(runtime: object, timeoutMs?: number): Promise<boolean> {
  const start = Date.now();
  while (true) {
    // Resource completion and derived callbacks can enqueue another provider.
    await Promise.resolve();
    await Promise.resolve();
    const pending: Promise<unknown>[] = [];
    let remaining = Infinity;
    for (const provider of lifetime(runtime).providers) {
      let hasWork = false;
      for (const work of provider.pending()) {
        hasWork = true;
        pending.push(work);
      }
      if (!hasWork) continue;
      const budget = (timeoutMs ?? provider.settleTimeoutMs) - (Date.now() - start);
      if (budget <= 0) return false;
      remaining = Math.min(remaining, budget);
    }
    if (pending.length === 0) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>(resolve => { timer = setTimeout(resolve, remaining); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Wait for the next settled unit of provider work. Streaming SSR publishes
 * after each one instead of once the runtime is quiescent.
 */
export async function nextDataRuntimeSettlement(
  runtime: object,
  budgetMs: number,
): Promise<'idle' | 'progress' | 'timeout'> {
  // Resource completion and derived callbacks can enqueue another provider.
  await Promise.resolve();
  await Promise.resolve();
  const pending = [...lifetime(runtime).providers].flatMap(provider => [...provider.pending()]);
  if (pending.length === 0) return 'idle';
  if (budgetMs <= 0) return 'timeout';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ...pending.map(work => work.then(() => 'progress' as const, () => 'progress' as const)),
      new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), budgetMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
