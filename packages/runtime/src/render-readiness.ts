import { getExtensionStore } from './kernel';

function readinessStore(): { collecting?: PromiseLike<void>[] } {
  return getExtensionStore('render-readiness', () => ({}));
}

/** @internal Register the first commit of a newly activated atomic region. */
export function noteRenderReadiness(ready: PromiseLike<void>): void {
  readinessStore().collecting?.push(ready);
}

/** @internal Collect atomic commits discovered by a synchronous publication. */
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
  if (current.length === 0) return undefined;
  return Promise.all(current).then(() => {});
}
