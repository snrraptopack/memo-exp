import { route, navigate } from '@memoized-dom/router';
import type { CloudService, ServiceTier, ServiceStatus } from '../types';

interface ServicesViewProps {
  services: readonly CloudService[];
}

export function ServicesView({ services }: ServicesViewProps) {
  const activeTier = route.query.get('tier') ?? 'all';
  const activeStatus = route.query.get('status') ?? 'all';
  const searchQuery = (route.query.get('q') ?? '').toLowerCase();
  const viewMode = route.query.get('view') ?? 'table';

  function updateFilters(tier: string, status: string, q: string, view: string) {
    navigate('/services', {
      query: {
        ...(tier !== 'all' ? { tier } : {}),
        ...(status !== 'all' ? { status } : {}),
        ...(q ? { q } : {}),
        ...(view !== 'table' ? { view } : {}),
      },
      replace: true,
    });
  }

  const filtered = services.filter((s) => {
    const matchesTier = activeTier === 'all' || s.tier === (activeTier as ServiceTier);
    const matchesStatus = activeStatus === 'all' || s.status === (activeStatus as ServiceStatus);
    const matchesQuery =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery) ||
      s.description.toLowerCase().includes(searchQuery) ||
      s.id.toLowerCase().includes(searchQuery);
    return matchesTier && matchesStatus && matchesQuery;
  });

  return (
    <div class="view-panel services-panel">
      {/* Top Header */}
      <div class="page-title-row">
        <div>
          <h1 class="page-title">Workloads & Microservices</h1>
          <p class="page-subtitle">
            Directory of active container clusters and edge network endpoints
          </p>
        </div>

        {/* View Mode Toggle Button */}
        <div class="view-mode-toggle">
          <button
            class={viewMode === 'table' ? 'btn-toggle active' : 'btn-toggle'}
            onClick={() => updateFilters(activeTier, activeStatus, searchQuery, 'table')}
            title="Table View"
          >
            📋 Table
          </button>
          <button
            class={viewMode === 'grid' ? 'btn-toggle active' : 'btn-toggle'}
            onClick={() => updateFilters(activeTier, activeStatus, searchQuery, 'grid')}
            title="Grid View"
          >
            🔲 Grid
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div class="filters-toolbar-box">
        {/* Tier Filter Tabs */}
        <div class="tier-pill-group">
          <button
            class={activeTier === 'all' ? 'tier-btn active' : 'tier-btn'}
            onClick={() => updateFilters('all', activeStatus, searchQuery, viewMode)}
          >
            All Workloads
          </button>
          <button
            class={activeTier === 'core' ? 'tier-btn active' : 'tier-btn'}
            onClick={() => updateFilters('core', activeStatus, searchQuery, viewMode)}
          >
            Core Tier
          </button>
          <button
            class={activeTier === 'edge' ? 'tier-btn active' : 'tier-btn'}
            onClick={() => updateFilters('edge', activeStatus, searchQuery, viewMode)}
          >
            Edge Nodes
          </button>
          <button
            class={activeTier === 'data' ? 'tier-btn active' : 'tier-btn'}
            onClick={() => updateFilters('data', activeStatus, searchQuery, viewMode)}
          >
            Data Tier
          </button>
        </div>

        {/* Status Dropdown Filter */}
        <div class="status-select-wrap">
          <select
            class="status-select"
            value={activeStatus}
            onChange={(e: Event) =>
              updateFilters(
                activeTier,
                (e.target as HTMLSelectElement).value,
                searchQuery,
                viewMode,
              )
            }
          >
            <option value="all">All Health States</option>
            <option value="healthy">Healthy Only</option>
            <option value="degraded">Degraded Only</option>
          </select>
        </div>

        {/* Live Search Box */}
        <div class="filter-search-box">
          <span class="search-ico">🔍</span>
          <input
            class="filter-search-input"
            type="text"
            placeholder="Search workloads by name, ID, region..."
            value={searchQuery}
            onInput={(e: Event) =>
              updateFilters(
                activeTier,
                activeStatus,
                (e.target as HTMLInputElement).value,
                viewMode,
              )
            }
          />
        </div>
      </div>

      {/* Query Sync Debug Ribbon */}
      <div class="url-state-ribbon">
        <span class="ribbon-label">Router Query Sync:</span>
        <span class="ribbon-tag font-mono">tier=&quot;{activeTier}&quot;</span>
        <span class="ribbon-tag font-mono">status=&quot;{activeStatus}&quot;</span>
        {searchQuery ? (
          <span class="ribbon-tag font-mono">q=&quot;{searchQuery}&quot;</span>
        ) : null}
        <span class="ribbon-tag font-mono">view=&quot;{viewMode}&quot;</span>
      </div>

      {/* Render Mode: Table vs Grid */}
      {viewMode === 'table' ? (
        <div class="table-container-card">
          <table class="services-data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Region</th>
                <th>Version</th>
                <th>Replicas</th>
                <th>Uptime</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((service) => (
                <tr
                  key={service.id}
                  class="clickable-table-row"
                  onClick={() =>
                    navigate('/services/:serviceId', {
                      params: { serviceId: service.id },
                      query: { tab: 'overview' },
                    })
                  }
                >
                  <td>
                    <div class="table-service-name-col">
                      <span class="service-table-name">{service.name}</span>
                      <span class="service-table-id font-mono">#{service.id}</span>
                    </div>
                  </td>
                  <td>
                    <span class="tier-badge-pill">{service.tier.toUpperCase()}</span>
                  </td>
                  <td>
                    <span class={`status-pill status-${service.status}`}>
                      <span class="status-dot" />
                      {service.status}
                    </span>
                  </td>
                  <td class="text-secondary-sub">{service.region}</td>
                  <td>
                    <span class="version-tag-pill font-mono">{service.version}</span>
                  </td>
                  <td class="text-secondary-sub">{service.replicas} pods</td>
                  <td class="font-mono text-emerald">{service.uptime}</td>
                  <td>
                    <button
                      class="btn-row-action"
                      onClick={() =>
                        navigate('/services/:serviceId', {
                          params: { serviceId: service.id },
                          query: { tab: 'telemetry' },
                        })
                      }
                    >
                      Metrics →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 ? (
            <div class="empty-state-box">
              <p>No microservices matching current query criteria.</p>
              <button
                class="btn-action-secondary"
                onClick={() => updateFilters('all', 'all', '', 'table')}
              >
                Clear All Filters
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        /* Grid View Mode */
        <div class="services-large-grid">
          {filtered.map((service) => (
            <div
              key={service.id}
              class="workload-grid-card"
              onClick={() =>
                navigate('/services/:serviceId', {
                  params: { serviceId: service.id },
                  query: { tab: 'overview' },
                })
              }
            >
              <div class="grid-card-header">
                <div>
                  <span class="grid-card-title">{service.name}</span>
                  <span class="grid-card-id font-mono">#{service.id}</span>
                </div>
                <span class={`status-pill status-${service.status}`}>
                  <span class="status-dot" />
                  {service.status}
                </span>
              </div>
              <p class="grid-card-desc">{service.description}</p>
              <div class="grid-card-stats-row">
                <div class="grid-stat-col">
                  <span class="grid-stat-label">Region</span>
                  <span class="grid-stat-val">{service.region}</span>
                </div>
                <div class="grid-stat-col">
                  <span class="grid-stat-label">Replicas</span>
                  <span class="grid-stat-val">{service.replicas} pods</span>
                </div>
                <div class="grid-stat-col">
                  <span class="grid-stat-label">Version</span>
                  <span class="grid-stat-val font-mono">{service.version}</span>
                </div>
              </div>
              <div class="grid-card-footer">
                <span class="tier-badge-pill">{service.tier.toUpperCase()}</span>
                <span class="grid-link-text">Inspect Details →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
