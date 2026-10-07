/** Optional SSR handoff, installed before requests materialize. */
import {getExtensionStore} from '@memoized-dom/runtime';
import {getActiveDataRuntime, installActiveRuntimeInitializer} from './active-runtime';
import {enableDataRestoration, resumeDataHydration, cancelDataHydration} from './restoration';
import type {SerializedDataState} from './types';

interface ActiveDataRuntimeBridge {
  restoreState?(state: unknown): void;
  completeHydration?(): void;
  cancelHydration?(): void;
  pendingState?: unknown;
}
let installed = false;

/** Default compiler output and public APIs preserve the standalone hydrate API. */
export function installActiveDataRestoration(): void {
  if (installed) return;
  installed = true;
  const bridge = getExtensionStore<ActiveDataRuntimeBridge>('mmd:data-runtime-active', () => ({}));
  installActiveRuntimeInitializer(runtime => {
    const restored = enableDataRestoration(runtime);
    if (bridge.pendingState !== undefined) {
      const state = bridge.pendingState;
      delete bridge.pendingState;
      restored.restoreState(state as SerializedDataState);
    }
  });
  bridge.restoreState = state => {
    enableDataRestoration(getActiveDataRuntime()).restoreState(state as SerializedDataState);
  };
  bridge.completeHydration = () => resumeDataHydration(getActiveDataRuntime());
  bridge.cancelHydration = () => {
    const runtime = getActiveDataRuntime();
    cancelDataHydration(runtime);
    runtime.clear();
  };
}
