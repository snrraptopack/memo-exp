import { navigate } from '@memoized-dom/router';
import type { DeploymentRecord } from '../types';

interface DeploymentsViewProps {
  deployments: readonly DeploymentRecord[];
}

export function DeploymentsView({ deployments }: DeploymentsViewProps) {
  return (
    <div class="view-panel deployments-panel">
      {/* Top Header */}
      <div class="page-title-row">
        <div>
          <h1 class="page-title">Deployments &amp; Release History</h1>
          <p class="page-subtitle">
            Immutable audit log of automated Canary rollouts and zero-downtime releases
          </p>
        </div>
      </div>

      {/* Deployments Table Card */}
      <div class="table-container-card">
        <table class="services-data-table">
          <thead>
            <tr>
              <th>Deployment ID</th>
              <th>Target Workload</th>
              <th>Release Version</th>
              <th>Commit SHA</th>
              <th>Initiated By</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((dep) => (
              <tr key={dep.id} class="clickable-table-row">
                <td>
                  <span class="font-mono text-secondary-sub">#{dep.id}</span>
                </td>
                <td>
                  <span class="service-table-name">{dep.serviceName}</span>
                </td>
                <td>
                  <span class="version-tag-pill font-mono">{dep.version}</span>
                </td>
                <td>
                  <code class="commit-sha-pill font-mono">{dep.commitSha}</code>
                </td>
                <td class="text-secondary-sub">{dep.author}</td>
                <td>
                  <span
                    class={
                      dep.status === 'success'
                        ? 'tag-status-success'
                        : dep.status === 'failed'
                        ? 'tag-status-danger'
                        : 'tag-status-warn'
                    }
                  >
                    {dep.status.toUpperCase()}
                  </span>
                </td>
                <td class="font-mono text-secondary-sub">{dep.duration}</td>
                <td>
                  <button
                    class="btn-row-action"
                    onClick={() =>
                      navigate('/services/:serviceId', {
                        params: { serviceId: dep.serviceId },
                        query: { tab: 'overview' },
                      })
                    }
                  >
                    Inspect →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
