/**
 * Shared fixture state reached through Vite alias resolution.
 */
export let count = 0;
export const items = [1];
export const selected = new Set<number>();
export const selectedCount = selected.size;

export async function increment(): Promise<void> {
  count++;
  await Promise.resolve();
  count++;
}
