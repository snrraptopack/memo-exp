/** Host context propagation is optional for ordinary browser updates. */
import { createStorage, type StorageShim } from './async-storage';
import {
  installApplicationRuntimeScope,
  runInApplicationRuntime,
  type ApplicationRuntime,
} from './kernel';

let storage: StorageShim<ApplicationRuntime> | undefined;

/** Install lazily so a later server entry can select AsyncLocalStorage. */
export function runWithApplicationRuntime<T>(runtime: ApplicationRuntime, run: () => T): T {
  if (!storage) {
    storage = createStorage<ApplicationRuntime>('runtime');
    installApplicationRuntimeScope(storage);
  }
  return runInApplicationRuntime(runtime, run);
}
