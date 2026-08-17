import { route, navigate } from '@memoized-dom/router';

export function NotFoundView() {
  return (
    <div class="view-container not-found-view">
      <div class="not-found-card-box">
        <div class="not-found-code">404</div>
        <h1 class="not-found-title">Route Not Found</h1>
        <p class="not-found-msg">
          The requested URL path <code class="not-found-path">{route.pathname}</code> does not match any registered application route.
        </p>
        <div class="not-found-actions">
          <button class="btn-primary" onClick={() => navigate('/')}>
            ← Go to Overview
          </button>
          <button class="btn-secondary" onClick={() => navigate('/services')}>
            Browse Microservices
          </button>
        </div>
      </div>
    </div>
  );
}
