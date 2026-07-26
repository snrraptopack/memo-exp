/**
 * Shared fixture state reached through Vite alias resolution.
 */
export let count = 0;

export async function increment(): Promise<void> {
  count++;
  await Promise.resolve();
  count++;
}
