import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { metrics } from '../session';
import { GridSkeleton, ErrorFallback } from '../components/Skeletons';

export let filterRange = '24h';

export function AnalyticsRoute() {
  return (
    <div class="route-container analytics-page">
      <div class="page-header">
        <div class="page-title">
          <h2>Streaming & Throughput Analytics</h2>
          <p class="subtitle">Sub-millisecond Time to First Byte and fine-grained DOM updates.</p>
        </div>

        <div class="range-selector">
          <button
            class={filterRange === '1h' ? 'btn btn-sm active' : 'btn btn-sm'}
            onClick={() => { filterRange = '1h'; }}
          >
            1 Hour
          </button>
          <button
            class={filterRange === '24h' ? 'btn btn-sm active' : 'btn btn-sm'}
            onClick={() => { filterRange = '24h'; }}
          >
            24 Hours
          </button>
          <button
            class={filterRange === '7d' ? 'btn btn-sm active' : 'btn btn-sm'}
            onClick={() => { filterRange = '7d'; }}
          >
            7 Days
          </button>
        </div>
      </div>

      <section class="section-card">
        <div class="section-card-header">
          <h3>⚡ Latency & Invalidation Telemetry</h3>
          <span class="badge badge-accent">Range: {filterRange}</span>
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

      <section class="section-card info-card">
        <div class="section-card-header">
          <h3>📊 Phase 6 Streaming Performance Comparison</h3>
        </div>
        <div class="perf-stats-grid">
          <div class="perf-stat">
            <span class="perf-num">0.6 ms</span>
            <span class="perf-desc">TTFB Initial Shell Flush</span>
          </div>
          <div class="perf-stat">
            <span class="perf-num">1,920 ops/s</span>
            <span class="perf-desc">StringDocument SSR Throughput</span>
          </div>
          <div class="perf-stat">
            <span class="perf-num">0 B</span>
            <span class="perf-desc">In-Memory Virtual DOM Allocations</span>
          </div>
          <div class="perf-stat">
            <span class="perf-num">100%</span>
            <span class="perf-desc">Lighthouse Accessibility & Best Practices</span>
          </div>
        </div>
      </section>
    </div>
  );
}
