import { route } from '@memoized-dom/router';
import { loadEntry } from '../data/entry';

export function Detail() {
  const page = $routed(({ params, signal }) => loadEntry(params.id ?? 'fast', signal));
  return <section class="page" data-detail={page.id}>
    <p class="eyebrow">Deferred entry</p>
    <h1>{page.title}</h1>
    <p>{page.description}</p>
    <label class="note-field">
      Detail note
      <input placeholder="Type a draft, then change the tab below" />
    </label>

    <nav aria-label="Detail destinations">
      <a route-to={{ path: '/detail/:id', params: { id: 'fast' } }}>Fast detail (400ms, resets draft)</a>
      <a route-to={{ path: '/detail/:id', params: { id: 'slow' } }}>Slow detail (2400ms, resets draft)</a>
    </nav>
    <p>Switch to a different detail to reset this input. Query-only changes keep it. Refreshing resets it; this demo does not persist drafts to storage.</p>
    <p data-tab>Current tab: {route.query.get('tab') ?? 'overview'}</p>
    <a route-to={{ path: '/detail/:id', params: { id: page.id }, query: { tab: 'notes' } }}>
      Notes tab (keeps draft)
    </a>
    {' · '}
    <a route-to={{ path: '/detail/:id', params: { id: page.id }, query: { tab: 'overview' } }}>
      Overview tab (keeps draft)
    </a>
  </section>;
}
