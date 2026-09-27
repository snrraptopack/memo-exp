let current = 0;
const listeners = new Set<() => void>();

export function getSnapshot() {
  return current;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function increment() {
  current++;
  for (const listener of listeners) listener();
}

export function decrement() {
  current--;
  for (const listener of listeners) listener();
}

export function subscriberCount() {
  return listeners.size;
}
