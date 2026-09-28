import { Suspense, lazy, use } from 'react';
import { fetchMessage } from './api';

const LazyBadge = lazy(() =>
  new Promise((resolve) => setTimeout(resolve, 900)).then(
    () => import('./LazyBadge'),
  ),
);

function Panel({ k, ms, label }: { k: string; ms: number; label: string }) {
  const msg = use(fetchMessage(k, ms));
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

      <h3>piecemeal — a boundary per read</h3>
      <Suspense fallback={<p>loading fast…</p>}>
        <Panel k="piecemeal-fast" ms={700} label="fast" />
      </Suspense>
      <Suspense fallback={<p>loading slow…</p>}>
        <Panel k="piecemeal-slow" ms={2200} label="slow" />
      </Suspense>

      <h3>atomic — one boundary holds both</h3>
      <Suspense fallback={<p>one fallback for the whole block…</p>}>
        <Panel k="atomic-fast" ms={700} label="fast" />
        <Panel k="atomic-slow" ms={2200} label="slow" />
      </Suspense>

      <h3>lazy — component code itself suspends</h3>
      <Suspense fallback={<p>loading chunk…</p>}>
        <LazyBadge />
      </Suspense>

      <p>
        <small>
          Piecemeal: "fast" lands at ~0.7s while "slow" still shows its
          fallback. Atomic: nothing appears until ~2.2s, then both at once.
          Lazy: the badge mounts after its chunk loads (~0.9s, cached on
          repeat visits).
        </small>
      </p>
    </section>
  );
}
