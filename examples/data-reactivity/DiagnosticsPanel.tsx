import type { FetchResource } from '@memoized-dom/data';
import type { Task } from './types';
import { serverConfig } from './mock-server';

interface DiagnosticsPanelProps {
  resource: FetchResource<Task[]>;
}

export function DiagnosticsPanel({ resource }: DiagnosticsPanelProps) {
  const statusColor =
    resource.status === 'success'
      ? '#10b981'
      : resource.status === 'pending'
      ? '#38bdf8'
      : resource.status === 'error'
      ? '#ef4444'
      : '#94a3b8';

  return (
    <aside class="diagnostics-panel">
      <div class="diagnostics-header">
        <h4>⚡ Resource & Invalidation Monitor</h4>
        <span class="pulse-beacon" style={`background-color: ${statusColor}`}></span>
      </div>

      <div class="diagnostics-grid">
        <div class="metric-card">
          <span class="metric-label">Status</span>
          <span class="metric-value" style={`color: ${statusColor}`}>
            {resource.status.toUpperCase()}
          </span>
        </div>

        <div class="metric-card">
          <span class="metric-label">Pending</span>
          <span class={`metric-value ${resource.pending ? 'is-active' : ''}`}>
            {resource.pending ? 'TRUE' : 'FALSE'}
          </span>
        </div>

        <div class="metric-card">
          <span class="metric-label">Refreshing</span>
          <span class={`metric-value ${resource.refreshing ? 'is-active' : ''}`}>
            {resource.refreshing ? 'TRUE' : 'FALSE'}
          </span>
        </div>

        <div class="metric-card">
          <span class="metric-label">Items Loaded</span>
          <span class="metric-value">{resource.data?.length ?? 0}</span>
        </div>

        <div class="metric-card">
          <span class="metric-label">Total Requests</span>
          <span class="metric-value">{serverConfig.requestCount}</span>
        </div>
      </div>

      {resource.error && (
        <div class="error-banner">
          <strong>⚠️ Request Error ({resource.error.kind}):</strong>
          <p>{resource.error.message}</p>
        </div>
      )}
    </aside>
  );
}
