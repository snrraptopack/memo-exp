import { increment, decrement } from './state';

/** Imported helper calls retain the canonical writes of the state module. */
export function addOne(): void {
  increment();
}

export function subtractOne(): void {
  decrement();
}
