/** Optional opaque-value pull frames over the shared application kernel. */
import {
  installVolatileDriver, markDirty, registerEntity, runInApplicationRuntime,
  type ApplicationRuntime, type Entity,
} from './kernel';

let installed = false;

function scheduleVolatileFrame(runtime: ApplicationRuntime): void {
  const k = runtime.state;
  if (k.volatileFrameScheduled || k.volatile.size === 0) return;
  const schedule = k.environment.schedule;
  if (schedule === null) return;
  k.volatileFrameScheduled = true;
  schedule(() => runInApplicationRuntime(runtime, () => {
    k.volatileFrameScheduled = false;
    try {
      if (k.environment.document.hidden !== true) {
        for (const id of k.volatile) markDirty(id, -1);
      }
    } finally {
      // Preserve pull recovery after failures, while respecting removed owners.
      scheduleVolatileFrame(runtime);
    }
  }));
}

/** General registration includes the opaque-pull capability. */
export function register(entity: Entity): void {
  if (!installed) {
    installed = true;
    installVolatileDriver(scheduleVolatileFrame);
  }
  registerEntity(entity);
}
