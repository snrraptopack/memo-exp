import { $fetch, $track, Group, Pending, Error } from '@memoized-dom/data';
import type { ErrorPolicyComponentProps } from '@memoized-dom/data';

interface Health {
  ok: boolean;
  expeditions: number;
}

function Checking() {
  return <span class="badge pending"><span class="spinner" /> checking…</span>;
}

function HealthFailed({ error, retry }: ErrorPolicyComponentProps) {
  return (
    <span class="badge badge-down">
      {error.message} <button onClick={retry}>Retry</button>
    </span>
  );
}

export function Home() {
  const health = $fetch<Health>('/api/health');
  const healthRequest = $track(health);

  let now = Date.now();
  const timer = setInterval(() => { now = Date.now(); }, 1000);
  cleanup(() => clearInterval(timer));

  effect(() => {
    document.title = `Fieldnotes — ${new Date(now).toLocaleTimeString()}`;
  });

  return (
    <section class="card">
      <h2>Base camp</h2>
      <p>
        Server:{' '}
        <Group>
          <Pending component={Checking} />
          <Error component={HealthFailed} />
          <span class={health.ok ? 'badge badge-ok' : 'badge badge-down'}>
            {health.ok ? `up · ${health.expeditions} expeditions logged` : 'down'}
          </span>
        </Group>
        {' '}
        <button onClick={() => healthRequest.refresh()}>
          {healthRequest.refreshing ? 'Pinging…' : 'Ping again'}
        </button>
      </p>
      <p class="muted">Local time: {new Date(now).toLocaleTimeString()}</p>
    </section>
  );
}
