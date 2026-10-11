/** Publish each side of an authored await without changing its value or error. */
export async function resumeContinuation<T>(
  value: T | PromiseLike<T>,
  publish: () => void,
): Promise<Awaited<T>> {
  publish();
  try {
    return await value;
  } finally {
    publish();
  }
}
