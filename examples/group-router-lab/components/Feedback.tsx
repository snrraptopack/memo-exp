import type { PresentationError } from '@memoized-dom/runtime';

export function InlinePending() {
  return <span class="pending" role="status">Waiting for this read...</span>;
}

export function RowPending() {
  return <span class="pending row-pending" role="status">This row is loading...</span>;
}

export function AtomicPending() {
  return <div class="atomic-pending" role="status">Preparing every row. The board and its input are not mounted yet.</div>;
}

export function Failure({ error, retry }: { error: PresentationError; retry: () => unknown }) {
  return <span class="failure" role="alert">
    <span>{error.kind}: {error.message}</span>
    <button onClick={retry}>Retry this read</button>
  </span>;
}
