/**
 * Dashboard View (`/`)
 * 
 * Demonstrates:
 * 1. Data loading via `githubApi.$fetch` from real GitHub REST API
 * 2. Pure derived calculations and multi-module state reads
 * 3. Sibling conditional rendering (`if`, `else-if`, `else`)
 * 4. List rendering with stable keys (`.map(...)`)
 * 5. Class-based state interactions via `projectStore`
 */

import { createGithubApi, type GithubSearchResponse } from '../services/api';
import {
  requestsPerSecond,
  activeWorkers,
  avgLatencyMs,
  errorCount,
  healthScore,
  healthStatusLabel,
  formattedOperations,
  recordOperation,
  recordErrorEvent,
  resolveErrors,
  adjustWorkers,
} from '../state/telemetry';
import { projectStore } from '../state/project-store';
import { StatCard } from '../components/StatCard';
import { TelemetryCanvas } from '../components/TelemetryCanvas';

export function DashboardView() {
  const githubApi = createGithubApi();
  
  // Real HTTP GET to GitHub Search API
  const featuredRepos = githubApi.$fetch<GithubSearchResponse>('search/repositories', {
    query: {
      q: 'stars:>70000',
      sort: 'stars',
      order: 'desc',
      per_page: 6,
    },
    cache: { scope: 'app' },
  });

  // Resource cleanup on view unmount
  cleanup(githubApi.clear);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-stone-900 via-stone-900/90 to-emerald-950/30 border border-line shadow-2xl relative overflow-hidden">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-semibold">
              LIVE SYSTEM READY
            </span>
            <span className="text-xs text-ink-soft font-mono">Region: us-east-1</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
            Engineering Telemetry & Hub
          </h1>
          <p className="text-sm text-ink-soft mt-1 max-w-2xl">
            Real-world compiler-driven reactive dashboard powered by Memoized DOM, connected live to GitHub APIs and background workers.
          </p>
        </div>

        {/* Quick Simulation Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => recordOperation(22)}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-bold text-xs shadow-lg shadow-emerald-900/40 transition-all flex items-center gap-1.5"
          >
            <span>⚡</span> Emit Request
          </button>
          <button
            onClick={recordErrorEvent}
            className="px-3 py-2 rounded-xl bg-elevated hover:bg-stone-700 text-rose-300 border border-rose-900/40 font-semibold text-xs transition-all"
          >
            Simulate Alert
          </button>
          <button
            onClick={resolveErrors}
            className="px-3 py-2 rounded-xl bg-elevated hover:bg-stone-700 text-emerald-300 border border-emerald-900/40 font-semibold text-xs transition-all"
          >
            Reset Incidents
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Operations"
          value={formattedOperations}
          subtitle="Processed since cluster boot"
          change="+12.4%"
          trend="up"
          icon="📈"
          accent="emerald"
        />
        <StatCard
          title="Throughput"
          value={`${requestsPerSecond} req/s`}
          subtitle={`Avg latency: ${avgLatencyMs}ms`}
          change={`${requestsPerSecond > 150 ? 'High' : 'Normal'}`}
          trend={requestsPerSecond > 150 ? 'up' : 'neutral'}
          icon="⚡"
          accent="emerald"
        />
        <StatCard
          title="Active Workers"
          value={activeWorkers}
          subtitle="Distributed compute nodes"
          change={`Pool: ${activeWorkers}/32`}
          trend="neutral"
          icon="⚙️"
          accent="amber"
        />
        <StatCard
          title="Cluster Health"
          value={`${healthScore}%`}
          subtitle={`${healthStatusLabel} · ${errorCount} active incidents`}
          change={errorCount === 0 ? 'Flawless' : `${errorCount} Issues`}
          trend={errorCount === 0 ? 'up' : 'down'}
          icon="🛡️"
          accent={errorCount === 0 ? 'emerald' : 'amber'}
        />
      </div>

      {/* Cluster Controls & Live Canvas Waveform */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Real-time Telemetry Canvas (2 cols) */}
        <div className="lg:col-span-2">
          <TelemetryCanvas />
        </div>

        {/* Worker Pool Controls (1 col) */}
        <div className="p-5 rounded-2xl bg-surface border border-line shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink mb-1 flex items-center gap-2">
              <span>🎛️</span> Worker Capacity Manager
            </h3>
            <p className="text-xs text-ink-soft mb-4">
              Dynamically scale active concurrent worker threads.
            </p>

            <div className="p-4 rounded-xl bg-base border border-line mb-4 text-center">
              <span className="text-3xl font-extrabold text-amber-400 font-mono">
                {activeWorkers}
              </span>
              <span className="text-xs text-ink-faint block mt-1">Dedicated Worker Units</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => adjustWorkers(-1)}
              disabled={activeWorkers <= 1}
              className="flex-1 py-2.5 rounded-xl bg-elevated hover:bg-stone-700 disabled:opacity-40 text-ink font-bold text-sm border border-line-strong transition-all"
            >
              - Scale Down
            </button>
            <button
              onClick={() => adjustWorkers(1)}
              disabled={activeWorkers >= 32}
              className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-stone-950 font-bold text-sm shadow-md shadow-emerald-950 transition-all"
            >
              + Scale Up
            </button>
          </div>
        </div>
      </div>

      {/* Live Featured Open-Source Projects (Real GitHub REST API) */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-ink">
                Live GitHub Ecosystem Radar
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
                Real API
              </span>
            </div>
            <p className="text-xs text-ink-soft mt-0.5">
              Fetched live from GitHub Public API via isolated <code className="font-mono text-emerald-400">createDataRuntime</code>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => featuredRepos.refresh()}
              disabled={featuredRepos.pending}
              className="px-3 py-1.5 rounded-lg bg-elevated hover:bg-stone-700 text-ink-soft font-semibold text-xs border border-line-strong transition-all flex items-center gap-1.5"
            >
              <span>🔄</span> {featuredRepos.refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <a
              route-to="/repos"
              className="px-3.5 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-800/60 font-semibold text-xs transition-all"
            >
              Explore All →
            </a>
          </div>
        </div>

        {/* Sibling Conditions: Loading / Error / Success */}
        <div if={featuredRepos.pending && !featuredRepos.data} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="h-36 rounded-2xl bg-base border border-line animate-pulse p-4 flex flex-col justify-between">
            <div className="h-4 bg-elevated rounded w-2/3"></div>
            <div className="h-3 bg-elevated rounded w-full"></div>
            <div className="h-3 bg-elevated rounded w-1/2"></div>
          </div>
          <div className="h-36 rounded-2xl bg-base border border-line animate-pulse p-4 flex flex-col justify-between">
            <div className="h-4 bg-elevated rounded w-2/3"></div>
            <div className="h-3 bg-elevated rounded w-full"></div>
            <div className="h-3 bg-elevated rounded w-1/2"></div>
          </div>
          <div className="h-36 rounded-2xl bg-base border border-line animate-pulse p-4 flex flex-col justify-between">
            <div className="h-4 bg-elevated rounded w-2/3"></div>
            <div className="h-3 bg-elevated rounded w-full"></div>
            <div className="h-3 bg-elevated rounded w-1/2"></div>
          </div>
        </div>

        <div else-if={!!featuredRepos.error && !featuredRepos.data} className="p-6 rounded-2xl bg-rose-950/30 border border-rose-800/50 text-rose-300 text-sm">
          <div className="font-bold mb-1">Failed to connect to GitHub REST API:</div>
          <p className="text-xs text-rose-400 mb-3">{featuredRepos.error?.message}</p>
          <button
            onClick={() => featuredRepos.refresh()}
            className="px-3 py-1.5 rounded-lg bg-rose-900 text-rose-100 text-xs font-semibold"
          >
            Retry Connection
          </button>
        </div>

        <div else className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {featuredRepos.data?.items.map((repo) => (
            <div
              key={repo.id}
              className="p-5 rounded-2xl bg-base border border-line hover:border-emerald-700/50 hover:bg-surface transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <img
                    src={repo.owner.avatar_url}
                    alt={repo.owner.login}
                    className="w-5 h-5 rounded-full border border-line-strong"
                  />
                  <span className="text-xs font-mono text-ink-soft truncate">
                    {repo.owner.login}
                  </span>
                </div>

                <a
                  route-to={{
                    path: '/repo/:owner/:name',
                    params: { owner: repo.owner.login, name: repo.name },
                  }}
                  className="text-base font-bold text-ink group-hover:text-emerald-400 transition-colors block truncate"
                >
                  {repo.name}
                </a>

                <p className="text-xs text-ink-soft mt-1.5 line-clamp-2 leading-relaxed">
                  {repo.description ?? 'No description provided.'}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-xs font-mono text-ink-soft">
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  ★ {(repo.stargazers_count / 1000).toFixed(1)}k
                </span>
                <span if={!!repo.language} className="px-2 py-0.5 rounded bg-surface text-ink-soft border border-line">
                  {repo.language}
                </span>
                <span className="text-ink-faint">
                  🍴 {repo.forks_count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Deployments Managed via Plain Class State */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-ink flex items-center gap-2">
              <span>🚀</span> Active Service Deployments
            </h2>
            <p className="text-xs text-ink-soft mt-0.5">
              Managed via Plain TypeScript Class <code className="font-mono text-emerald-400">ProjectStore</code> (no proxies, zero-cost updates).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {projectStore.deployments.map((dep) => (
            <div
              key={dep.id}
              className="p-4 rounded-2xl bg-base border border-line flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold ${
                    dep.status === 'active'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                      : dep.status === 'deploying'
                      ? 'bg-amber-950 text-amber-400 border border-amber-800/60 animate-pulse'
                      : 'bg-surface text-ink-soft border border-line'
                  }`}>
                    {dep.status}
                  </span>
                  <span className="text-[10px] font-mono text-ink-faint">{dep.environment}</span>
                </div>

                <h4 className="text-sm font-bold text-ink truncate">{dep.name}</h4>
                <p className="text-xs font-mono text-ink-soft mt-1">🌿 {dep.branch}</p>
                <p className="text-[11px] font-mono text-ink-faint mt-0.5">commit #{dep.commitHash}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-line flex items-center justify-between">
                <span className="text-[10px] text-ink-faint font-mono">{dep.updatedAt}</span>
                <button
                  onClick={() => projectStore.triggerRedeploy(dep.id)}
                  disabled={dep.status === 'deploying'}
                  className="px-2.5 py-1 rounded-lg bg-surface hover:bg-elevated disabled:opacity-40 text-ink-soft text-xs font-mono border border-line-strong transition-all"
                >
                  Redeploy
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </main>
  );
}
