/** Structural callback props reuse accepted slot and list lifetimes. */
import { HostError } from '../host/protocol';
import { createList, type NativeListEntry } from './list';
import { createSlot, type NativeSlotFactory } from './slot';
import { child, createView, type NativeFrame, type NativePresentation } from './view';

export interface NativeRenderCallback<T> {
  readonly create: (frame: NativeFrame, item: T, index: number) => NativeListEntry<T>;
  readonly key: ((item: T, index: number) => unknown) | null;
}

/**
 * A stable descriptor reuses keyed rows. Descriptor changes replace the owned
 * range through the existing slot acceptance gate, preserving old rows on
 * refusal. The envelope is only a native comment, never a layout wrapper.
 */
export function createCallbackList<T>(
  frame: NativeFrame,
  readItems: () => readonly T[],
  readCallback: () => NativeRenderCallback<T>,
): NativePresentation {
  let selected: NativeRenderCallback<T> | undefined;
  let factory: NativeSlotFactory | undefined;

  return createSlot(frame, () => {
    const callback = readCallback();

    if (
      callback === null || typeof callback !== 'object' ||
      typeof callback.create !== 'function' ||
      (callback.key !== null && typeof callback.key !== 'function')
    ) {
      throw new HostError(
        'invalidRenderCallback',
        'Native lists require a compiled render callback descriptor',
      );
    }

    if (callback !== selected) {
      selected = callback;
      factory = contentFrame => createView(
        contentFrame,
        {
          key: 'memoized-dom:render-callback-envelope',
          nodes: [{ parent: null, node: { kind: 'comment', value: 'memo:callback-rows' } }],
        },
        () => [],
        [child('rows', 0, listFrame => createList(
          listFrame,
          readItems,
          callback.create,
          callback.key ?? undefined,
        ))],
      );
    }

    return factory;
  });
}
