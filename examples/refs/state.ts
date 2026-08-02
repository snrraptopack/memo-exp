// Simple identity marker for reactive state
export function state<T>(value: T): T {
  return value;
}

// Overloads: TypeScript knows T is the return type when a function is passed
export function derived<T>(value: T | (() => T)): T {
  if (typeof value === 'function') {
    return (value as () => T)();
  }
  return value;
}

export function useState<T>(initial: T) {
    return {
      value: initial,
      set(next: T | ((prev: T) => T)) {
        this.value =
          typeof next === 'function'
            ? (next as (prev: T) => T)(this.value)
            : next;
      },
    };
}
