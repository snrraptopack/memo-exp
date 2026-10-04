import { createCoreDataRuntime } from './runtime-core';
import { enableDataReads } from './read-resource';
import type { DataRuntime, DataRuntimeOptions } from './types';

export { resumeDataHydration, cancelDataHydration } from './runtime-core';

/** Public runtimes expose every source capability on the same ownership boundary. */
export function createDataRuntime(options: DataRuntimeOptions = {}): DataRuntime {
  return enableDataReads(createCoreDataRuntime(options));
}
