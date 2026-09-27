import { getActiveApplicationRuntime, getExtensionStore, onCommitFinished } from './kernel';

interface Publication {
  readonly regions: PromiseLike<void>[];
  resolve(): void;
  reject(error: unknown): void;
}
function readinessStore(): { collecting?: PromiseLike<void>[]; queued: Publication[] } {
  return getExtensionStore('render-readiness', () => ({ queued: [] }));
}

onCommitFinished((failed, error) => {
  const store = readinessStore();
  const publications = store.queued.splice(0);
  for (const publication of publications) {
    if (failed) publication.reject(error);
    else void Promise.all(publication.regions).then(publication.resolve, publication.reject);
  }
});

/** @internal Register the first commit of a newly activated atomic region. */
export function noteRenderReadiness(ready: PromiseLike<void>): void {
  const store = readinessStore();
  store.collecting?.push(ready);
  for (const publication of store.queued) publication.regions.push(ready);
}

/** @internal Include the scheduled render drain without changing its timing. */
export function collectRenderReadiness(publish: () => void): Promise<void> | undefined {
  const store = readinessStore();
  const previous = store.collecting;
  const current: PromiseLike<void>[] = [];
  store.collecting = current;
  try { publish(); }
  finally {
    store.collecting = previous;
    previous?.push(...current);
  }
  const state = getActiveApplicationRuntime().state;
  if (state.dirty.size !== 0 || state.inCommit) {
    const ready = new Promise<void>((resolve, reject) => {
      store.queued.push({ regions: current, resolve, reject });
    });
    // A caller may use collection just for scroll, or abandon the publication.
    void ready.catch(() => {});
    return ready;
  }
  if (current.length === 0) return undefined;
  return Promise.all(current).then(() => {});
}
