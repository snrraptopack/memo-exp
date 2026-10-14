/** Build-selected runtime entry. Application imports retain their normal name. */
export * from '@memoized-dom/runtime/core';

import { HostError } from '../host/protocol';
import type { createMountAdapter } from './mount';

type MountAdapter = ReturnType<typeof createMountAdapter>;
let adapter: MountAdapter | undefined;

/** The launcher installs its owned host before loading the application entry. */
export function installNativeMount(next: MountAdapter): () => void {
  if (adapter !== undefined) {
    throw new HostError('mountAlreadyInstalled', 'A native mounting host is already installed');
  }

  adapter = next;

  return () => {
    if (adapter === next) {
      adapter = undefined;
    }
  };
}

/** Same authored call; asynchronous acceptance belongs to the host adapter. */
export function mount(target: string, component: () => unknown) {
  if (adapter === undefined) {
    throw new HostError('missingMountHost', 'The desktop launcher must install its host before evaluating the entry');
  }

  return adapter.mount(target, component);
}
