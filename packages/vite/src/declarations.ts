import { unlink } from 'node:fs/promises';

const removals = new Map<string, Promise<void>>();

/** Coalesce client/SSR cleanup so Windows never deletes the same file twice concurrently. */
export function removeDeclaration(file: string): Promise<void> {
  const pending = removals.get(file);
  if (pending) return pending;
  const removal = unlink(file)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    })
    .finally(() => { removals.delete(file); });
  removals.set(file, removal);
  return removal;
}
