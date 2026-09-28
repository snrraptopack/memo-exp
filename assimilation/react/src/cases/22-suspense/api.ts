export interface Message {
  id: string;
  text: string;
}

const cache = new Map<string, Promise<Message>>();

export function fetchMessage(key: string, ms: number): Promise<Message> {
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = new Promise<Message>((resolve) =>
      setTimeout(
        () => resolve({ id: key, text: `${key} resolved after ${ms}ms` }),
        ms,
      ),
    );
    cache.set(key, pending);
  }
  return pending;
}
