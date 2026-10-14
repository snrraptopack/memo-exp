/** Accepted native presentation for compiler-owned component content slots. */
import { HostError } from '../host/protocol';

import { NativeConditional } from './conditional';
import type {
  NativeFrame,
  NativePresentation,
} from './view';

export type NativeSlotFactory = (
  frame: NativeFrame,
) => NativePresentation;

/**
 * Mount a caller-owned content factory into a callee's native region.
 *
 * The compiler keeps authored factories stable. A new factory identity gets
 * a monotonically increasing selection index so refusal followed by another
 * replacement cannot accidentally look like the accepted selection.
 */
export function createSlot(
  frame: NativeFrame,
  readFactory: () => NativeSlotFactory | null | undefined,
): NativePresentation {
  let selected: NativeSlotFactory | null = null;
  let selectedIndex = 0;

  const pick = (): number => {
    const next = readFactory();

    if (next == null) {
      selected = null;
      return 0;
    }

    if (typeof next !== 'function') {
      throw new HostError(
        'invalidSlot',
        'Native content slots require a compiler-owned presentation factory',
      );
    }

    if (next !== selected) {
      selected = next;
      selectedIndex++;
    }

    return selectedIndex;
  };
  const createSelected = (contentFrame: NativeFrame): NativePresentation => {
    if (selected === null) {
      throw new HostError('invalidSlot', 'Native content slot has no selected factory');
    }

    return selected(contentFrame);
  };

  return new NativeConditional(frame, pick, index => {
    if (index === 0) {
      return null;
    }

    return index === selectedIndex ? createSelected : undefined;
  });
}
