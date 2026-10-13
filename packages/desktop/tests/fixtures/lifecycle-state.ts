// A compiler-shaped helper module uses the existing canonical cell machinery.
// This fixture tests the internal ABI; semantic TSX emission is still M3 work.
import { defineStateCell, readCell, updateCell } from '@memoized-dom/runtime/core';

export const count = defineStateCell('process-lifecycle-state#count', 0);

export function readCount(): number {
  return readCell<number>(count);
}

export function increment(): void {
  updateCell<number>(count, value => value + 1);
}
