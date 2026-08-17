import { navigate } from '@memoized-dom/router';
import type { CloudService, DeploymentRecord } from '../types';

interface OverviewViewProps {
  services: readonly CloudService[];
  deployments: readonly DeploymentRecord[];
}

export function OverviewView({ services, deployments }: OverviewViewProps) {
  const healthyCount = services.filter((s) => s.status === 'healthy').length;
  const degradedCount = services.filter((s) => s.status === 'degraded').length;
  const totalReplicas = services.reduce((acc, s) => acc + s.replicas, 0);

  return (
    <div class="view-panel overview-panel">
      {/* Top Banner */}
      <div class="page-title-row">
        <div>
          <h1 class="page-title">Global Cloud Overview</h1>
          <p class="page-subtitle">
            Infrastructure telemetry, microservice health, and automated Canary deployments
          </p>
        </div>
        <div class="header-actions-group">
          <button
            class="btn-action-primary"
            onClick={() => navigate('/services', { query: { tier: 'core' } })}
          >
            Explore Workloads →
          </button>
        </div>
      </div>

      {/* Primary Telemetry Stat Cards */}
      <div class="stats-overview-grid">
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-title">Microservices</span>
            <span class="stat-icon">📦</span>
          </div>
          <div class="stat-card-body">
            <span class="stat-number">{services.length}</span>
            <div class="stat-tags-row">
              <span class="tag-status-success">{healthyCount} Operational</span>
              {degradedCount > 0 ? (
                <span class="tag-status-warn">{degradedCount} Degraded</span>
              ) : null}
            </div>
          </div>
          <span class="stat-footer-text">3 global regions active</span>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-title">Active Pod Replicas</span>
            <span class="stat-icon">⚡</span>
          </div>
          <div class="stat-card-body">
            <span class="stat-number">{totalReplicas}</span>
            <span class="stat-badge-neutral">Auto-Scaling On</span>
          </div>
          <span class="stat-footer-text">Avg CPU Load: 38.2%</span>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-title">Edge Traffic</span>
            <span class="stat-icon">🌐</span>
          </div>
          <div class="stat-card-body">
            <span class="stat-number">62,400</span>
            <span class="stat-unit">req / sec</span>
          </div>
          <span class="stat-footer-text">P99 Edge Latency: 4.2ms</span>
        </div>

        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-title">Cluster Uptime</span>
            <span class="stat-icon">🛡️</span>
          </div>
          <div class="stat-card-body">
            <span class="stat-number">99.98%</span>
            <span class="tag-status-success">SLA Met</span>
          </div>
          <span class="stat-footer-text">Past 30 rolling days</span>
        </div>
      </div>

      {/* Two-Column Grid: Services Grid & Recent Deployments */}
      <div class="overview-split-layout">
        {/* Left: Services Cards Grid */}
        <div class="panel-section">
          <div class="panel-section-header">
            <div>
              <h2 class="panel-section-title">Production Workloads</h2>
              <span class="panel-section-desc">Direct route links with state preservation</span>
            </div>
            <button
              class="btn-subtle"
              onClick={() => navigate('/services')}
            >
              View All (5) →
            </button>
          </div>

          <div class="overview-services-grid">
            {services.map((service) => (
              <div
                key={service.id}
                class="workload-card"
                onClick={() =>
                  navigate('/services/:serviceId', {
                    params: { serviceId: service.id },
                    query: { tab: 'overview' },
                  })
                }
              >
                <div class="workload-card-header">
                  <div class="workload-meta">
                    <span class="workload-name">{service.name}</span>
                    <span class="workload-tier">{service.tier.toUpperCase()}</span>
                  </div>
                  <span class={`status-pill status-${service.status}`}>
                    <span class="status-dot" />
                    {service.status}
                  </span>
                </div>
                <p class="workload-desc">{service.description}</p>
                <div class="workload-footer">
                  <span class="info-pill">{service.region}</span>
                  <span class="info-pill">{service.replicas} pods</span>
                  <span class="info-pill font-mono">{service.version}</span>
                  <span class="workload-arrow">Inspect →</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Recent Deployments Stream */}
        <div class="panel-section">
          <div class="panel-section-header">
            <div>
              <h2 class="panel-section-title">Canary Deployments</h2>
              <span class="panel-section-desc">Automated rollout pipeline</span>
            </div>
            <button
              class="btn-subtle"
              onClick={() => navigate('/deployments')}
            >
              All Releases →
            </button>
          </div>

          <div class="deployments-compact-stream">
            {deployments.slice(0, 4).map((dep) => (
              <div
                key={dep.id}
                class="deployment-compact-row"
                onClick={() =>
                  navigate('/services/:serviceId', {
                    params: { serviceId: dep.serviceId },
                    query: { tab: 'logs' },
                  })
                }
              >
                <div class={`deploy-indicator-dot deploy-${dep.status}`} />
                <div class="deploy-compact-body">
                  <div class="deploy-compact-top">
                    <span class="deploy-compact-name">{dep.serviceName}</span>
                    <span class="deploy-compact-version font-mono">{dep.version}</span>
                  </div>
                  <div class="deploy-compact-bottom">
                    <span class="deploy-author">{dep.author}</span>
                    <span class="deploy-time font-mono">{dep.timestamp}</span>
                  </div>
                </div>
                <span class="deploy-duration font-mono">{dep.duration}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
