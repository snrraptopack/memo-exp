/** One cancellation boundary shared by route modules and authored preparation. */
export async function awaitRouteWork<Value>(
  loading: PromiseLike<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Route loading was superseded', 'AbortError');
  }
  let abort = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(
      signal.reason ?? new DOMException('Route loading was superseded', 'AbortError'),
    );
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const value = await Promise.race([loading, canceled]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

