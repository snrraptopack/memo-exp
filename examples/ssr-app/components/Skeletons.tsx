export function CardSkeleton() {
  return <div class="skeleton-box skeleton-card"></div>;
}

export function GridSkeleton() {
  return (
    <div class="metrics-grid skeleton-container">
      <div class="skeleton-box skeleton-card"></div>
      <div class="skeleton-box skeleton-card"></div>
      <div class="skeleton-box skeleton-card"></div>
      <div class="skeleton-box skeleton-card"></div>
    </div>
  );
}

export function FeedSkeleton() {
  return (
    <div class="feed-list skeleton-container">
      <div class="skeleton-box skeleton-row"></div>
      <div class="skeleton-box skeleton-row"></div>
      <div class="skeleton-box skeleton-row"></div>
      <div class="skeleton-box skeleton-row"></div>
    </div>
  );
}

export function AvatarSkeleton() {
  return <span class="avatar-loading">...</span>;
}

export function ErrorFallback({ error, retry }: { error: { message: string }; retry: () => void }) {
  return (
    <div class="error-banner">
      <span>⚠️ Data stream error: {error.message}</span>
      <button class="btn btn-sm" onClick={retry}>Retry</button>
    </div>
  );
}
