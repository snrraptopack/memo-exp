import { createCoreDataRuntime, type CoreDataRuntime } from './runtime-core';
import { enableDataSerialization } from './serialization';
import { enableDataReads } from './read-resource';
import type { DataRuntime, DataRuntimeOptions } from './types';

export { resumeDataHydration, cancelDataHydration } from './runtime-core';

/** Public runtimes expose every source capability on the same ownership boundary. */
export function createDataRuntime(options: DataRuntimeOptions = {}): DataRuntime {
  return exposeDataRuntime(createCoreDataRuntime(options));
}

/** Add public capabilities to the same lazily created internal runtime. */
export function exposeDataRuntime(runtime: CoreDataRuntime): DataRuntime {
  return enableDataSerialization(enableDataReads(runtime));
}
