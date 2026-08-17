import { route, navigate } from '@memoized-dom/router';
import type { CloudService } from '../types';

interface ServiceDetailViewProps {
  serviceId: string;
  services: readonly CloudService[];
  onDeployVersion: (serviceId: string, version: string) => void;
  onScaleReplicas: (serviceId: string, replicas: number) => void;
  isDeploying: boolean;
}

export function ServiceDetailView({
  serviceId,
  services,
  onDeployVersion,
  onScaleReplicas,
  isDeploying,
}: ServiceDetailViewProps) {
  const service = services.find((s) => s.id === serviceId);
  const activeTab = route.query.get('tab') ?? 'overview';

  if (!service) {
    return (
      <div class="view-panel not-found-panel">
        <div class="not-found-card-box">
          <div class="not-found-code">404</div>
          <h2 class="not-found-title">Workload Not Found</h2>
          <p class="not-found-msg">
            No active microservice matches ID <code class="font-mono">{serviceId}</code>.
          </p>
          <button
            class="btn-action-primary"
            onClick={() => navigate('/services')}
          >
            ← Return to Services Directory
          </button>
        </div>
      </div>
    );
  }

  function switchTab(tab: string) {
    navigate('/services/:serviceId', {
      params: { serviceId },
      query: { tab },
    });
  }

  function handleTriggerDeploy() {
    const nextVer = `v${parseInt(service?.version.slice(1) ?? '1') + 1}.0.0`;
    onDeployVersion(serviceId, nextVer);
  }

  return (
    <div class="view-panel service-detail-panel">
      {/* Top Breadcrumb & Route Meta Bar */}
      <div class="detail-top-nav-bar">
        <div class="detail-breadcrumb-group">
          <button
            class="detail-breadcrumb-link"
            onClick={() => navigate('/services')}
          >
            ← Microservices
          </button>
          <span class="detail-breadcrumb-sep">/</span>
          <span class="detail-breadcrumb-active">{service.name}</span>
        </div>

        <div class="detail-route-param-tag font-mono">
          param: :serviceId = &quot;{serviceId}&quot;
        </div>
      </div>

      {/* Hero Workload Summary Card */}
      <div class="detail-hero-card">
        <div class="detail-hero-left">
          <div class="detail-hero-title-row">
            <h1 class="detail-hero-title">{service.name}</h1>
            <span class={`status-pill status-${service.status}`}>
              <span class="status-dot" />
              {service.status}
            </span>
            <span class="tier-badge-pill">{service.tier.toUpperCase()}</span>
          </div>
          <p class="detail-hero-desc">{service.description}</p>
        </div>

        <div class="detail-hero-actions">
          <button
            class="btn-action-primary"
            disabled={isDeploying}
            onClick={handleTriggerDeploy}
          >
            {isDeploying ? 'Deploying Rolling Release...' : '⚡ Deploy Rolling Update'}
          </button>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar (Synchronized with ?tab= query parameter) */}
      <div class="detail-tabs-container">
        <button
          class={activeTab === 'overview' ? 'tab-item active' : 'tab-item'}
          onClick={() => switchTab('overview')}
        >
          Workload Spec
        </button>
        <button
          class={activeTab === 'telemetry' ? 'tab-item active' : 'tab-item'}
          onClick={() => switchTab('telemetry')}
        >
          Live Telemetry
        </button>
        <button
          class={activeTab === 'logs' ? 'tab-item active' : 'tab-item'}
          onClick={() => switchTab('logs')}
        >
          Container Logs ({service.logs.length})
        </button>
        <button
          class={activeTab === 'scaling' ? 'tab-item active' : 'tab-item'}
          onClick={() => switchTab('scaling')}
        >
          Replicas &amp; Scaling
        </button>
      </div>

      {/* Tab Panel 1: Workload Specification */}
      {activeTab === 'overview' ? (
        <div class="tab-pane spec-pane">
          <div class="spec-overview-grid">
            <div class="spec-info-card">
              <span class="spec-label">Assigned Region</span>
              <span class="spec-value">{service.region}</span>
              <span class="spec-sub">Anycast latency: 4ms</span>
            </div>
            <div class="spec-info-card">
              <span class="spec-label">Active Image Version</span>
              <span class="spec-value font-mono">{service.version}</span>
              <span class="spec-sub">Digest: sha256:8f92a1...</span>
            </div>
            <div class="spec-info-card">
              <span class="spec-label">Replica Allocation</span>
              <span class="spec-value">{service.replicas} Pods</span>
              <span class="spec-sub">Max cap: 64 pods</span>
            </div>
            <div class="spec-info-card">
              <span class="spec-label">Uptime SLA</span>
              <span class="spec-value font-mono text-emerald">{service.uptime}</span>
              <span class="spec-sub">Past 30 rolling days</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tab Panel 2: Live Telemetry */}
      {activeTab === 'telemetry' ? (
        <div class="tab-pane telemetry-pane">
          <div class="telemetry-cards-grid">
            {service.metrics.map((metric) => (
              <div key={metric.timestamp} class="telemetry-box">
                <div class="telemetry-box-header">
                  <span class="telemetry-time font-mono">[{metric.timestamp} UTC]</span>
                  <span class="telemetry-rps font-mono">{metric.rps.toLocaleString()} req/s</span>
                </div>
                <div class="telemetry-progress-list">
                  <div class="telemetry-bar-item">
                    <div class="telemetry-bar-label-row">
                      <span>CPU Utilization</span>
                      <span class="font-mono">{metric.cpuPercent}%</span>
                    </div>
                    <div class="telemetry-track">
                      <div
                        class="telemetry-fill"
                        style={{ width: `${metric.cpuPercent}%` }}
                      />
                    </div>
                  </div>

                  <div class="telemetry-bar-item">
                    <div class="telemetry-bar-label-row">
                      <span>Memory Allocated</span>
                      <span class="font-mono">{metric.memoryMb} MB</span>
                    </div>
                    <div class="telemetry-track">
                      <div
                        class="telemetry-fill fill-amber"
                        style={{ width: `${Math.min(100, metric.memoryMb / 80)}%` }}
                      />
                    </div>
                  </div>

                  <div class="telemetry-metric-meta-row">
                    <span class="meta-label">P99 Round-trip Latency:</span>
                    <span class="meta-val font-mono">{metric.latencyMs} ms</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Tab Panel 3: Live Container Logs */}
      {activeTab === 'logs' ? (
        <div class="tab-pane logs-pane">
          <div class="terminal-container">
            <div class="terminal-header">
              <div class="terminal-title-group">
                <span class="terminal-dot red" />
                <span class="terminal-dot yellow" />
                <span class="terminal-dot green" />
                <span class="terminal-title">pod-logs-stdout-stream (all pods)</span>
              </div>
              <span class="terminal-status-tag">SOCKET LIVE</span>
            </div>
            <div class="terminal-stream-box">
              {service.logs.map((log) => (
                <div key={log.id} class="terminal-log-line">
                  <span class="log-ts font-mono">[{log.timestamp}]</span>
                  <span class={`log-tag log-${log.level}`}>
                    {log.level.toUpperCase()}
                  </span>
                  <span class="log-text">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Tab Panel 4: Replicas & Scaling */}
      {activeTab === 'scaling' ? (
        <div class="tab-pane scaling-pane">
          <div class="scaling-card">
            <h3 class="scaling-title">Horizontal Pod Auto-Scaling</h3>
            <p class="scaling-desc">
              Adjust minimum container replicas running in parallel for this workload.
            </p>
            <div class="scaling-control-row">
              <span class="scaling-current-badge">{service.replicas} Active Pods</span>
              <button
                class="btn-scaling"
                disabled={service.replicas <= 1}
                onClick={() => onScaleReplicas(serviceId, service.replicas - 1)}
              >
                - Scale Down
              </button>
              <button
                class="btn-scaling"
                disabled={service.replicas >= 32}
                onClick={() => onScaleReplicas(serviceId, service.replicas + 1)}
              >
                + Scale Up
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
