import type { Note, Store } from './store';

export function createNoteService(store: Store) {
  let sequence = store.expeditions.flatMap(e => e.notes).length;

  return {
    add(expeditionId: string, text: string, by: string): Note {
      const expedition = store.expeditions.find(e => e.id === expeditionId);
      if (expedition === undefined) {
        throw new Error(`Unknown expedition '${expeditionId}'`);
      }
      const note: Note = { id: `n${++sequence}`, text, by };
      expedition.notes.push(note);
      return note;
    },
    remove(expeditionId: string, noteId: string): Note | null {
      const expedition = store.expeditions.find(e => e.id === expeditionId);
      const index =
        expedition?.notes.findIndex(n => n.id === noteId) ?? -1;
      return index === -1 ? null : expedition!.notes.splice(index, 1)[0]!;
    },
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
