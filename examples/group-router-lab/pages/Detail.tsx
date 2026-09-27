import { $routed } from '@memoized-dom/router';
import { loadEntry } from '../data/entry';

export function Detail() {
  const page = $routed(({ params, signal }) => loadEntry(params.id ?? 'fast', signal));
  return <section class="page" data-detail={page.id}>
    <p class="eyebrow">Deferred entry</p>
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <label class="note-field">
      Detail note
      <input placeholder="This is a fresh route instance" />
    </label>

    <nav aria-label="Detail destinations">
      <a route-to={{ path: '/detail/:id', params: { id: 'fast' } }}>Fast detail</a>
      <a route-to={{ path: '/detail/:id', params: { id: 'slow' } }}>Slow detail</a>
    </nav>
    <p>Switch path parameters to remount this input. Change only the query or hash to retain it.</p>
    <a route-to={{ path: '/detail/:id', params: { id: page.id }, query: { tab: 'notes' } }}>
      Change query, retain draft
    </a>
  </section>;
}
