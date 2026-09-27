import { wait } from './transport';

/** Universal client preparation; no server-only context or endpoint is required. */
export async function loadEntry(id: string, signal: AbortSignal) {
  const delay = id === 'fast' ? 400 : 2400;
  await wait(delay, signal);
  return { id, title: `Prepared detail: ${id}`, description: `Entry waited ${delay}ms before this component mounted.` };
}
