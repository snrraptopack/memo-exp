import { $routed, redirectRoute, blockNavigation } from '@memoized-dom/router';
import { $track } from '@memoized-dom/data';
import { postNote, deleteNote } from '#server-functions';

export function ExpeditionDetail() {
  // Server-backed preparation: services never ships to the browser — the
  // compiler strips this body and the server runs it. The returned page is
  // what the component reads.
  const page = $routed(async ({ params, services, locals }) => {
    const expedition = await services.expeditions.find(params.id);
    if (expedition === null) return redirectRoute('/expeditions');
    return { expedition, viewer: locals.visitor };
  });

  const nodes = { noteInput: null as HTMLInputElement | null };
  let lastPost = null as ReturnType<typeof postNote> | null;
  const deleting = new Set<string>();

  // Leave-guard: block navigation while the note input holds a draft.
  const stopGuard = blockNavigation(() => {
    if (nodes.noteInput !== null && nodes.noteInput.value.trim() !== '') {
      return confirm('Discard your draft note?') ? undefined : false;
    }
  });
  cleanup(stopGuard);

  function addNote() {
    const input = nodes.noteInput;
    if (input === null || input.value.trim() === '') return;
    const text = input.value;
    input.value = '';

    // Optimistic insert; onSuccess swaps it for the server's note (real id),
    // onError removes it — the tracker knows which request settled.
    const optimistic = { id: 'pending', text, by: page.viewer };
    page.expedition.notes.push(optimistic);

    lastPost = postNote(page.expedition.id, text);
    const tracker = $track(lastPost);
    tracker.onSuccess((saved) => {
      const index = page.expedition.notes.indexOf(optimistic);
      if (index !== -1) page.expedition.notes.splice(index, 1, saved);
    });
    tracker.onError(() => {
      const index = page.expedition.notes.indexOf(optimistic);
      if (index !== -1) page.expedition.notes.splice(index, 1);
    });
  }

  function removeNote(noteId: string) {
    deleting.add(noteId);
    const removed = deleteNote(page.expedition.id, noteId);
    $track(removed).onSuccess(() => {
      const index = page.expedition.notes.findIndex(n => n.id === noteId);
      if (index !== -1) page.expedition.notes.splice(index, 1);
      deleting.delete(noteId);
    });
    $track(removed).onError(() => {
      deleting.delete(noteId);
    });
  }

  return (
    <article>
      <h3>{page.expedition.name}</h3>
      <p class="meta">
        <span class="chip">{page.expedition.region}</span>{' '}
        <span class="chip">{page.expedition.days} days</span>{' '}
        <span class="chip">logged as {page.viewer}</span>
      </p>

      <div class="note-form">
        <input
          ref={[nodes.noteInput, (el: HTMLInputElement) => el.focus()]}
          placeholder="Add a field note…"
        />
        <button onClick={addNote}>Add note</button>
      </div>

      {lastPost !== null ? (
        <p class={
          `status-line ${$track(lastPost).pending ? 'pending'
            : $track(lastPost).error !== null ? 'error'
            : 'muted'}`
        }>
          {$track(lastPost).pending
            ? 'Saving note…'
            : $track(lastPost).error !== null
              ? `Note failed: ${$track(lastPost).error?.message}`
              : 'Note saved'}
        </p>
      ) : null}

      <ul class="plain">
        {page.expedition.notes.map(n => (
          <li key={n.id} class="note">
            {n.text} <span class="meta">— {n.by}</span>
            <button
              disabled={deleting.has(n.id)}
              onClick={() => removeNote(n.id)}
            >
              {deleting.has(n.id) ? '…' : '✕'}
            </button>
          </li>
        ))}
      </ul>

      <a class="back" route-to="/expeditions">← All expeditions</a>
    </article>
  );
}
