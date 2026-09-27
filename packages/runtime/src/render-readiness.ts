import { getActiveApplicationRuntime, getExtensionStore, onCommitFinished, onRuntimeDisposed } from './kernel';

interface Publication {
  readonly regions: PromiseLike<void>[];
  resolve(): void;
  reject(error: unknown): void;
}
function readinessStore(): { collecting?: PromiseLike<void>[]; queued: Publication[]; pending: Set<Publication> } {
  return getExtensionStore('render-readiness', () => ({ queued: [], pending: new Set<Publication>() }));
}

onRuntimeDisposed(() => {
  const store = readinessStore();
  const error = new DOMException('Render publication was disposed', 'AbortError');
  for (const publication of store.pending) publication.reject(error);
  store.queued.length = 0;
});

function publicationReadiness(regions: PromiseLike<void>[], queued: boolean): Promise<void> {
  const store = readinessStore();
  const ready = new Promise<void>((resolve, reject) => {
    const publication: Publication = {
      regions,
      resolve() { store.pending.delete(publication); resolve(); },
      reject(error) { store.pending.delete(publication); reject(error); },
    };
    store.pending.add(publication);
    if (queued) store.queued.push(publication);
    else void Promise.all(regions).then(publication.resolve, publication.reject);
  });
  // A caller may collect just for scroll, or abandon its publication.
  void ready.catch(() => {});
  return ready;
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
    return publicationReadiness(current, true);
  }
  if (current.length === 0) return undefined;
  return publicationReadiness(current, false);
}
