import { wait } from './transport';

/** Universal client preparation; no server-only context or endpoint is required. */
export async function loadEntry(id: string, signal: AbortSignal) {
  await wait(2000, signal);
  return { id, title: `Prepared detail: ${id}`, description: 'Entry finished before this component mounted.' };
}
