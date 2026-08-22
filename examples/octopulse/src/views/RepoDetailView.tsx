/**
 * Repository Deep Dive View (`/repo/:owner/:name`)
 * 
 * Demonstrates:
 * 1. Reading route parameters from compiler-managed router (`route.params['owner']`, `route.params['name']`)
 * 2. Multi-resource data fetching with `@memoized-dom/data`
 * 3. Sibling conditions and mapped issue items with stable domain keys
 * 4. Declarative back navigation with `route-to`
 */

import { route } from '@memoized-dom/router';
import { createGithubApi, type GithubRepoItem, type GithubIssueItem } from '../services/api';

export function RepoDetailView() {
  const githubApi = createGithubApi();
  const owner = route.params['owner'] ?? '';
  const name = route.params['name'] ?? '';

  // Fetch full repo metadata
  const repoResource = githubApi.$fetch<GithubRepoItem>(`repos/${owner}/${name}`, {
    cache: { scope: 'app' },
  });

  // Fetch live open issues
  const issuesResource = githubApi.$fetch<GithubIssueItem[]>(`repos/${owner}/${name}/issues`, {
    query: { state: 'open', per_page: 8 },
    cache: { scope: 'app' },
  });

  // Cleanup on unmount
  cleanup(githubApi.clear);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Back to catalog */}
      <div>
        <a
          route-to="/repos"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-elevated text-ink-soft hover:text-emerald-400 border border-line text-xs font-semibold transition-all"
        >
          <span>←</span> Back to Repositories
        </a>
      </div>

      {/* Repo Details Header */}
      <div if={repoResource.pending && !repoResource.data} className="p-6 rounded-3xl bg-surface border border-line animate-pulse h-48">
        <div className="h-6 bg-elevated rounded w-1/3 mb-4"></div>
        <div className="h-4 bg-elevated rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-elevated rounded w-1/2"></div>
      </div>

      <div else-if={!!repoResource.error && !repoResource.data} className="p-6 rounded-3xl bg-rose-950/30 border border-rose-800/60 text-rose-300">
        <h2 className="font-bold text-lg mb-1">Failed to load repository details</h2>
        <p className="text-xs text-rose-400 mb-3">{repoResource.error?.message}</p>
        <button
          onClick={() => repoResource.refresh()}
          className="px-3.5 py-1.5 rounded-lg bg-rose-900 text-rose-100 text-xs font-semibold"
        >
          Retry
        </button>
      </div>

      <div else className="p-6 sm:p-8 rounded-3xl bg-surface border border-line shadow-2xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src={repoResource.data?.owner.avatar_url}
              alt={owner}
              className="w-14 h-14 rounded-2xl border border-line-strong shadow-lg"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-ink-soft">{owner} /</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
                  {repoResource.data?.language ?? 'Software'}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-ink mt-0.5">
                {name}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={repoResource.data?.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-elevated hover:bg-stone-700 text-ink text-xs font-bold border border-line-strong transition-all flex items-center gap-1.5"
            >
              <span>GitHub ↗</span>
            </a>
          </div>
        </div>

        <p className="text-sm text-ink-soft leading-relaxed max-w-4xl">
          {repoResource.data?.description ?? 'No repository description available.'}
        </p>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-line">
          <div className="p-3.5 rounded-xl bg-base border border-line">
            <span className="text-[11px] text-ink-faint font-mono block">STARS</span>
            <span className="text-lg font-bold text-amber-400 font-mono">
              ★ {repoResource.data?.stargazers_count.toLocaleString()}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-base border border-line">
            <span className="text-[11px] text-ink-faint font-mono block">FORKS</span>
            <span className="text-lg font-bold text-ink font-mono">
              🍴 {repoResource.data?.forks_count.toLocaleString()}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-base border border-line">
            <span className="text-[11px] text-ink-faint font-mono block">OPEN ISSUES</span>
            <span className="text-lg font-bold text-emerald-400 font-mono">
              ⚡ {repoResource.data?.open_issues_count.toLocaleString()}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-base border border-line">
            <span className="text-[11px] text-ink-faint font-mono block">LAST ACTIVITY</span>
            <span className="text-xs font-semibold text-ink-soft font-mono block mt-1">
              {repoResource.data?.updated_at ? new Date(repoResource.data.updated_at).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Open Issues Section */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <span>🐛</span> Live Open Issues & Tickets
          </h2>
          <button
            onClick={() => issuesResource.refresh()}
            disabled={issuesResource.pending}
            className="text-xs text-ink-soft hover:text-emerald-400 transition-colors"
          >
            {issuesResource.refreshing ? 'Updating...' : 'Refresh Issues'}
          </button>
        </div>

        {/* Loading / Error / Success branches */}
        <div if={issuesResource.pending && !issuesResource.data} className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-base border border-line animate-pulse"></div>
          ))}
        </div>

        <div else-if={!!issuesResource.error && !issuesResource.data} className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs">
          Unable to fetch open issues for this repository: {issuesResource.error?.message}
        </div>

        <div else className="space-y-3">
          {issuesResource.data?.map((issue) => (
            <div
              key={issue.id}
              className="p-4 rounded-xl bg-base border border-line hover:border-line-strong transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-emerald-400 font-semibold">#{issue.number}</span>
                  <a
                    href={issue.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-bold text-ink hover:text-emerald-400 transition-colors"
                  >
                    {issue.title}
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint font-mono">
                  <span>Opened by {issue.user.login}</span>
                  <span>•</span>
                  <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>💬 {issue.comments} comments</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {issue.labels.map((label) => (
                  <span
                    key={label.id}
                    className="text-[10px] px-2 py-0.5 rounded font-mono font-medium"
                    style={{ backgroundColor: `#${label.color}22`, color: `#${label.color}`, border: `1px solid #${label.color}55` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

    </main>
  );
}
