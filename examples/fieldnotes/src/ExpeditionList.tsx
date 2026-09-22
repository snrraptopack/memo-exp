import { getExpeditions } from '#server-functions';
import { Group, Pending, Error, $track } from '@memoized-dom/data';
import type { ErrorPolicyComponentProps } from '@memoized-dom/data';

function Loading() {
  return <p class="pending"><span class="spinner" /> Loading expeditions…</p>;
}

function Failed({ error, retry }: ErrorPolicyComponentProps) {
  return (
    <p class="error">
      {error.message} <button onClick={retry}>Retry</button>
    </p>
  );
}

export function ExpeditionList() {
  const expeditions = getExpeditions();
  const request = $track(expeditions);

  return (
    <Group>
      <Pending component={Loading} />
      <Error component={Failed} />
      <div>
        <ul class="plain">
          {expeditions.map(e => (
            <li key={e.id} class="expedition">
              <a route-to={{ path: '/expeditions/:id', params: { id: e.id } }}>
                {e.name}
              </a>
              <div class="meta">
                <span class="chip">{e.region}</span>{' '}
                <span class="chip">{e.days} days</span>{' '}
                <span class="chip">{e.notes} notes</span>
              </div>
            </li>
          ))}
        </ul>
        <p>
          <button onClick={() => request.refresh()} disabled={request.refreshing}>
            {request.refreshing ? 'Refreshing…' : 'Refresh list'}
          </button>
        </p>
      </div>
    </Group>
  );
}
