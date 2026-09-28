export interface Message {
  id: string;
  text: string;
}

// No promise cache: MMD bodies run once per instance, so $read gets its
// promise at creation and never re-derives it. (React needs the cache for
// render-stable promise identity — see the twin's api.ts.)
export function fetchMessage(key: string, ms: number): Promise<Message> {
  return new Promise<Message>((resolve) =>
    setTimeout(
      () => resolve({ id: key, text: `${key} resolved after ${ms}ms` }),
      ms,
    ),
  );
}
