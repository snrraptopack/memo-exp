interface FailureProps {
  error: { message: string };
  retry: () => void;
}

export function LocalPending() {
  return <span class="inline-feedback pending-feedback"><span class="mini-spinner" /> waiting</span>;
}

export function LocalFailure({ error, retry }: FailureProps) {
  return <button class="inline-feedback error-feedback" onClick={retry}>{error.message} Retry</button>;
}

export function AtomicPending() {
  return (
    <article class="atomic-skeleton" aria-label="Loading the complete dashboard">
      <div class="skeleton-heading">
        <span class="large-spinner" />
        <div><p class="micro-label">Atomic first mount</p><strong>Waiting for all three sources</strong></div>
      </div>
      <div class="skeleton-line" />
      <div class="skeleton-grid">
        <div class="skeleton-block" /><div class="skeleton-block" /><div class="skeleton-block" />
      </div>
      <p class="skeleton-note">900 ms profile · 2.1 s metrics · 3.4 s activity</p>
    </article>
  );
}

export function AtomicFailure({ error, retry }: FailureProps) {
  return (
    <article class="atomic-error">
      <p class="micro-label">Boundary caught a source failure</p>
      <h2>That request did not complete.</h2>
      <p>{error.message}</p>
      <button onClick={retry}>Retry failed source</button>
    </article>
  );
}
