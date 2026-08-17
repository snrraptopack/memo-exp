import { navigate } from '@memoized-dom/router';

interface SidebarProps {
  currentPath: string;
}

export function Sidebar({ currentPath }: SidebarProps) {
  const isOverview = currentPath === '/' || currentPath === '/overview';
  const isServices = currentPath.startsWith('/services');
  const isDeployments = currentPath.startsWith('/deployments');
  const isSettings = currentPath.startsWith('/settings');

  return (
    <aside class="app-sidebar">
      {/* Workspace Brand Badge */}
      <div class="sidebar-brand-box" onClick={() => navigate('/')}>
        <div class="brand-logo-icon">⚡</div>
        <div class="brand-info">
          <span class="brand-name">Apex Cloud</span>
          <span class="brand-env">PROD-CLUSTER-01</span>
        </div>
      </div>

      {/* Navigation Links */}
      <div class="sidebar-nav-section">
        <span class="sidebar-section-label">PLATFORM CONTROL</span>
        <nav class="sidebar-nav-links">
          <button
            class={isOverview ? 'sidebar-link active' : 'sidebar-link'}
            onClick={() => navigate('/')}
          >
            <span class="nav-icon">📊</span>
            <span class="nav-text">Overview</span>
            {isOverview ? <span class="nav-active-pip" /> : null}
          </button>

          <button
            class={isServices ? 'sidebar-link active' : 'sidebar-link'}
            onClick={() => navigate('/services')}
          >
            <span class="nav-icon">📦</span>
            <span class="nav-text">Microservices</span>
            <span class="nav-count-badge">5</span>
            {isServices ? <span class="nav-active-pip" /> : null}
          </button>

          <button
            class={isDeployments ? 'sidebar-link active' : 'sidebar-link'}
            onClick={() => navigate('/deployments')}
          >
            <span class="nav-icon">🚀</span>
            <span class="nav-text">Deployments</span>
            {isDeployments ? <span class="nav-active-pip" /> : null}
          </button>

          <button
            class={isSettings ? 'sidebar-link active' : 'sidebar-link'}
            onClick={() => navigate('/settings')}
          >
            <span class="nav-icon">⚙️</span>
            <span class="nav-text">Settings</span>
            {isSettings ? <span class="nav-active-pip" /> : null}
          </button>
        </nav>
      </div>

      {/* Quick Shortcuts Section */}
      <div class="sidebar-nav-section">
        <span class="sidebar-section-label">PINNED WORKLOADS</span>
        <div class="pinned-workloads-list">
          <button
            class={
              currentPath === '/services/auth-vault'
                ? 'pinned-item active'
                : 'pinned-item'
            }
            onClick={() =>
              navigate('/services/:serviceId', {
                params: { serviceId: 'auth-vault' },
                query: { tab: 'overview' },
              })
            }
          >
            <span class="pinned-status-dot status-healthy" />
            <span class="pinned-name">auth-vault</span>
          </button>
          <button
            class={
              currentPath === '/services/edge-gateway'
                ? 'pinned-item active'
                : 'pinned-item'
            }
            onClick={() =>
              navigate('/services/:serviceId', {
                params: { serviceId: 'edge-gateway' },
                query: { tab: 'telemetry' },
              })
            }
          >
            <span class="pinned-status-dot status-healthy" />
            <span class="pinned-name">edge-gateway</span>
          </button>
          <button
            class={
              currentPath === '/services/realtime-pubsub'
                ? 'pinned-item active'
                : 'pinned-item'
            }
            onClick={() =>
              navigate('/services/:serviceId', {
                params: { serviceId: 'realtime-pubsub' },
                query: { tab: 'logs' },
              })
            }
          >
            <span class="pinned-status-dot status-degraded" />
            <span class="pinned-name">realtime-pubsub</span>
          </button>
        </div>
      </div>

      {/* Footer Profile & Status */}
      <div class="sidebar-footer">
        <div class="cluster-pill">
          <span class="pulse-emerald" />
          <div class="cluster-pill-text">
            <span class="cluster-name">us-east-1</span>
            <span class="cluster-sla">99.99% SLA</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
