import { getServerContext } from '@memoized-dom/server';
import { delay } from '#server/latency';

export async function getExpeditions() {
  const { services } = getServerContext();
  await delay(900);
  return services.expeditions.all().map(e => ({
    id: e.id,
    name: e.name,
    region: e.region,
    days: e.days,
    notes: e.notes.length,
  }));
}

export async function postNote(expeditionId: string, text: string) {
  const { locals, services } = getServerContext();
  if (text.trim() === '') {
    throw new Error('Note text cannot be empty');
  }
  if (text.toLowerCase().includes('spam')) {
    throw new Error('Note rejected by content filter');
  }
  await delay(1500);
  return services.notes.add(expeditionId, text, locals.visitor);
}

export async function deleteNote(expeditionId: string, noteId: string) {
  const { services } = getServerContext();
  await delay(700);
  const removed = services.notes.remove(expeditionId, noteId);
  if (removed === null) {
    throw new Error('Unknown note');
  }
  return removed;
}
