/** Optional writes operate on the same controller, entry and notification queue. */
import { resourceController } from './resource';
import { installResourceWriter, type ResourceWriter } from './resource-write-capability';
import type { CoreDataRuntime } from './runtime-core';

export const writeFetchResource: ResourceWriter = (resource, change, mutable) => {
  const controller = resourceController(resource);
  if (controller.disposed) throw new Error(`Cannot ${mutable ? 'mutate' : 'update'} a disposed fetch resource`);
  const entry = controller.entry;
  const snapshot = entry?.snapshot ?? controller.snapshot;
  const current = snapshot.data as Parameters<typeof change>[0];
  const result = change(current);
  // A local write wins over a read that began before it, even if that fetcher
  // ignores cancellation. A throwing callback must not cancel the request.
  entry?.cancelRequest();
  snapshot.data = mutable ? current : result;
  snapshot.status = 'success';
  snapshot.error = null;
  if (entry === null) controller.notify();
  else { entry.hasData = true; entry.emit(); }
};

export function enableDataWrites<T extends CoreDataRuntime>(runtime: T): T {
  installResourceWriter(writeFetchResource);
  return runtime;
}
