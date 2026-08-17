import { route, navigate, back, forward } from '@memoized-dom/router';

interface NavHeaderProps {
  clusterStatus: string;
}

export function NavHeader({ clusterStatus }: NavHeaderProps) {
  const path = route.pathname;
  const isOverview = path === '/' || path === '/overview';
  const isServices = path.startsWith('/services');
  const isSettings = path.startsWith('/settings');

  return (
    <header class="nav-header">
      <div class="nav-left-col">
        {/* Brand Logo & Cluster Tag */}
        <div class="nav-brand" onClick={() => navigate('/')}>
          <div class="nav-logo-icon">⚡</div>
          <div class="nav-brand-text">
            <span class="nav-brand-title">Apex Cloud</span>
            <span class="nav-brand-sub">Console</span>
          </div>
        </div>

        {/* History Nav Buttons */}
        <div class="nav-history-group">
          <button
            class="history-btn"
            onClick={() => back()}
            title="Browser Back"
          >
            ←
          </button>
          <button
            class="history-btn"
            onClick={() => forward()}
            title="Browser Forward"
          >
            →
          </button>
        </div>

        {/* Top-Level Route Tabs */}
        <nav class="nav-tabs">
          <button
            class={isOverview ? 'nav-tab-link active' : 'nav-tab-link'}
            onClick={() => navigate('/')}
          >
            Overview
          </button>
          <button
            class={isServices ? 'nav-tab-link active' : 'nav-tab-link'}
            onClick={() => navigate('/services')}
          >
            Microservices
          </button>
          <button
            class={isSettings ? 'nav-tab-link active' : 'nav-tab-link'}
            onClick={() => navigate('/settings')}
          >
            Settings
          </button>
        </nav>
      </div>

      {/* Nav Right (Cluster Health & Active URL Breadcrumb) */}
      <div class="nav-right-col">
        <div class="current-path-badge" title="Current Route Path">
          <span class="path-label">URL:</span>
          <span class="path-value">{route.pathname}</span>
        </div>

        <div class="cluster-health-indicator">
          <span class="health-pulse-dot" />
          <span class="health-text">{clusterStatus}</span>
        </div>
      </div>
    </header>
  );
}
