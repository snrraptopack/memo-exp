import { $read, Group } from '@memoized-dom/data';
import { fetchMessage } from './api';

function LineSkeleton() {
  return <p>loading…</p>;
}

function BlockSkeleton() {
  return <p>one fallback for the whole block…</p>;
}

function Panel({ k, ms, label }: { k: string; ms: number; label: string }) {
  const msg = $read(fetchMessage(k, ms));
  return (
    <p>
      {label}: {msg.text}
    </p>
  );
}

export function SuspenseCase() {
  return (
    <section>
      <h2>Suspense + lazy vs Group/suspend + $read</h2>

      <h3>piecemeal — suspend per component (React sibling boundaries)</h3>
      <Group pending={LineSkeleton}>
        <Panel suspend k="piecemeal-fast" ms={700} label="fast" />
        <Panel suspend k="piecemeal-slow" ms={2200} label="slow" />
      </Group>

      <h3>atomic — one suspended region (React whole-boundary)</h3>
      <Group pending={BlockSkeleton}>
        <section suspend>
          <Panel k="atomic-fast" ms={700} label="fast" />
          <Panel k="atomic-slow" ms={2200} label="slow" />
        </section>
      </Group>

      <h3>finer than React — no suspend, skeleton at the read site</h3>
      <Group pending={LineSkeleton}>
        <Panel k="site-fast" ms={900} label="fast" />
        <Panel k="site-slow" ms={2600} label="slow" />
      </Group>

      <h3>lazy — no component-level twin</h3>
      <p>
        <small>
          MMD splits code at <code>route</code> boundaries — this very page is
          a lazy route chunk. Component-level <code>lazy()</code> has no
          equivalent (no dynamic component value — error-log #001).
        </small>
      </p>
    </section>
  );
}
