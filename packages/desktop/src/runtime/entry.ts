/** Build-selected runtime entry. Application imports retain their normal name. */
export * from '@memoized-dom/runtime/core';

import { HostError } from '../host/protocol';
import type { createMountAdapter } from './mount';

type MountAdapter = ReturnType<typeof createMountAdapter>;
const mountHostKey = Symbol.for('memoized-dom:native-mount-host');

function hostSlot(): { adapter?: MountAdapter } {
  const realm = globalThis as unknown as Record<PropertyKey, unknown>;
  return (realm[mountHostKey] ??= {}) as { adapter?: MountAdapter };
}

/** The launcher installs its owned host before loading the application entry. */
export function installNativeMount(next: MountAdapter): () => void {
  const slot = hostSlot();
  if (slot.adapter !== undefined) {
    throw new HostError('mountAlreadyInstalled', 'A native mounting host is already installed');
  }

  slot.adapter = next;

  return () => {
    if (slot.adapter === next) {
      slot.adapter = undefined;
    }
  };
}

/** Same authored call; asynchronous acceptance belongs to the host adapter. */
export function mount(target: string, component: () => unknown) {
  const adapter = hostSlot().adapter;
  if (adapter === undefined) {
    throw new HostError('missingMountHost', 'The desktop launcher must install its host before evaluating the entry');
  }

  return adapter.mount(target, component);
}
