/** Optional opaque-value pull frames over the shared application kernel. */
import {
  getActiveApplicationRuntime, markDirty, onRegistryChange, onRuntimeDisposed,
  registerEntity, runInApplicationRuntime,
  type ApplicationRuntime, type Entity,
} from './kernel';

let installed = false;

interface VolatileState { ids: Set<string>; scheduled: boolean }
const STORE = 'mmd:volatile';

function stateFor(runtime: ApplicationRuntime): VolatileState {
  let state = runtime.state.extensions.get(STORE) as VolatileState | undefined;
  if (state === undefined) {
    // Compiler-known registration may precede installation of this capability.
    const ids = new Set<string>();
    for (const entity of runtime.state.registry.values()) if (entity.volatile === true) ids.add(entity.id);
    state = { ids, scheduled: false };
    runtime.state.extensions.set(STORE, state);
  }
  return state;
}

function scheduleVolatileFrame(runtime: ApplicationRuntime): void {
  const k = runtime.state;
  const state = stateFor(runtime);
  if (state.scheduled || state.ids.size === 0) return;
  const schedule = k.environment.schedule;
  if (schedule === null) return;
  state.scheduled = true;
  schedule(() => runInApplicationRuntime(runtime, () => {
    state.scheduled = false;
    try {
      if (k.environment.document.hidden !== true) {
        for (const id of state.ids) markDirty(id, -1);
      }
    } finally {
      // Preserve pull recovery after failures, while respecting removed owners.
      if (state.ids.size > 0) scheduleVolatileFrame(runtime);
    }
  }));
}

/** General registration includes the opaque-pull capability. */
export function register(entity: Entity): void {
  if (!installed) {
    installed = true;
    onRegistryChange((id, kind) => {
      const runtime = getActiveApplicationRuntime();
      const volatile = kind === 'add' && runtime.state.registry.get(id)?.volatile === true;
      const state = volatile ? stateFor(runtime)
        : runtime.state.extensions.get(STORE) as VolatileState | undefined;
      if (state === undefined) return;
      if (volatile) state.ids.add(id);
      else state.ids.delete(id);
      if (kind === 'add') scheduleVolatileFrame(runtime);
    });
    onRuntimeDisposed(runtime => {
      const state = runtime.state.extensions.get(STORE) as VolatileState | undefined;
      state?.ids.clear();
    });
  }
  registerEntity(entity);
  // General registration explicitly selects this capability, including older
  // compiler output. Seed any previously registered pull entities once.
  scheduleVolatileFrame(getActiveApplicationRuntime());
}
