let current = 0;
const listeners = new Set<() => void>();
let subscriptions = 0;
let changeOnSubscribe = false;

export function getSnapshot() {
  return current;
}

export function subscribe(listener: () => void) {
  subscriptions++;
  if (changeOnSubscribe) {
    current++;
    changeOnSubscribe = false;
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function increment() {
  current++;
  for (const listener of listeners) listener();
}

export function subscriberCount() {
  return listeners.size;
}

export function subscriptionCount() {
  return subscriptions;
}

export function scheduleMissedChange() {
  changeOnSubscribe = true;
}
