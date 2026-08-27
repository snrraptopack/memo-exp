import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { metrics, logs } from '../session';
import { GridSkeleton, CardSkeleton, ErrorFallback } from '../components/Skeletons';

export let quickCounter = 0;

export function DashboardRoute() {
  return (
    <div class="route-container dashboard-page">
      <div class="page-header">
        <div class="page-title">
          <h2>Architecture Overview</h2>
          <p class="subtitle">Real-time metrics, streaming throughput, and active request monitors.</p>
        </div>

        <div class="quick-actions">
          <button
            class="btn btn-primary"
            onClick={() => {
              quickCounter++;
            }}
          >
            ⚡ Test Client Reactivity ({quickCounter})
          </button>
        </div>
      </div>

      {/* 1. Real-time System Metrics */}
      <section class="section-card">
        <div class="section-card-header">
          <h3>⚡ Key Performance Indicators</h3>
          <span class="stream-badge">● Live Stream Settled</span>
        </div>

        <Group data={metrics}>
          <Pending component={GridSkeleton} />
          <ErrorArm component={ErrorFallback} />
          <div class="metrics-grid">
            {metrics.map((m) => (
              <div class="metric-card" key={m.id}>
                <span class="metric-label">{m.label}</span>
                <div class="metric-value-row">
                  <strong class="metric-val">{m.value}</strong>
                  <span class={m.trend === 'up' ? 'delta delta-up' : 'delta delta-down'}>
                    {m.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Group>
      </section>

      {/* 2. System Activity Log */}
      <section class="section-card">
        <div class="section-card-header">
          <h3>📋 Live Execution Logs</h3>
          <span class="badge badge-sm">Auto-replayed</span>
        </div>

        <Group data={logs}>
          <Pending component={CardSkeleton} />
          <ErrorArm component={ErrorFallback} />
          <ul class="logs-list">
            {logs.map((log) => (
              <li class="log-row" key={log.id}>
                <span class={`log-level level-${log.level}`}>{log.level.toUpperCase()}</span>
                <span class="log-message">{log.message}</span>
                <span class="log-time">{log.time}</span>
              </li>
            ))}
          </ul>
        </Group>
      </section>
    </div>
  );
}
