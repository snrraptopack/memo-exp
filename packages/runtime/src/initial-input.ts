/** Optional initial-HTML handoff for compiler-proven text-like input values. */
export function bindInitialInputValue(input: HTMLInputElement, value: unknown): void {
  // Assignment establishes the dirty-value flag, just as ordinary creation.
  // Clearing the HTML value attribute then restores its property-only default
  // without resetting the assigned current value. Native form reset stays equal
  // to the ordinary DOM factory rather than reverting to serialized HTML state.
  input.value=(value??'') as string;
  input.removeAttribute('value');
}
