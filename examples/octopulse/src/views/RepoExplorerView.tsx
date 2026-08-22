/**
 * Live Repository Explorer View (`/repos`)
 * 
 * Demonstrates:
 * 1. Component-local `let` state for live search parameters
 * 2. DOM ref binding on the search input (`let inputRef: HTMLInputElement | undefined`)
 * 3. Component `cleanup` attaching and detaching a global keyboard listener (press '/' to focus search)
 * 4. Real-time `$fetch` requests to GitHub API with query parameters
 * 5. Dynamic list rendering with `.map(...)` and stable keys
 * 6. Object-based navigation with `route-to`
 */

import { createGithubApi, type GithubSearchResponse } from '../services/api';

export function RepoExplorerView() {
  const githubApi = createGithubApi();
  let searchInput: HTMLInputElement | undefined;
  let queryText = 'memoized';
  let activeLanguage = 'all';
  let sortOrder: 'stars' | 'forks' | 'updated' = 'stars';

  // Derived effective query string for GitHub API
  const effectiveQuery = 
    activeLanguage === 'all'
      ? (queryText.trim() || 'stars:>1000')
      : `${queryText.trim() || 'stars:>500'} language:${activeLanguage}`;

  // Live fetch resource from GitHub API
  const searchResults = githubApi.$fetch<GithubSearchResponse>('search/repositories', {
    query: {
      q: effectiveQuery,
      sort: sortOrder,
      order: 'desc',
      per_page: 12,
    },
    cache: { scope: 'app' },
  });

  // Resource cleanup on unmount
  cleanup(githubApi.clear);

  // Global hotkey: press '/' anywhere to focus the search bar
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === '/' && document.activeElement !== searchInput) {
      event.preventDefault();
      searchInput?.focus();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  cleanup(() => window.removeEventListener('keydown', onKeyDown));

  function handleSearchSubmit(e: Event) {
    e.preventDefault();
    if (searchInput) {
      queryText = searchInput.value;
      searchResults.refresh();
    }
  }

  function selectLanguage(lang: string) {
    activeLanguage = lang;
    searchResults.refresh();
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
              GitHub Ecosystem Radar
            </h1>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 text-xs font-mono">
              Live REST API
            </span>
          </div>
          <p className="text-xs text-ink-soft mt-1">
            Search live GitHub repositories using compiler-driven reactive data fetching.
          </p>
        </div>

        {/* Refresh & Hotkey hint */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-line text-[11px] font-mono text-ink-soft">
            <kbd className="px-1.5 py-0.5 rounded bg-elevated border border-line-strong text-ink">/</kbd> Focus Search
          </span>
          <button
            onClick={() => searchResults.refresh()}
            disabled={searchResults.pending}
            className="px-3.5 py-2 rounded-xl bg-surface hover:bg-elevated disabled:opacity-40 text-ink text-xs font-semibold border border-line-strong transition-all flex items-center gap-1.5"
          >
            <span>🔄</span> {searchResults.refreshing ? 'Searching...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Search Input & Filter Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-surface border border-line shadow-xl space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft text-sm">
              🔍
            </span>
            <input
              ref={searchInput}
              defaultValue={queryText}
              placeholder="Search repositories (e.g. memoized-dom, rust, react, bun, vite)..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-base border border-line focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-ink text-sm outline-none transition-all placeholder:text-ink-faint font-medium"
            />
          </div>
          <button
            type="submit"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-bold text-sm shadow-md shadow-emerald-950 transition-all"
          >
            Search
          </button>
        </form>

        {/* Filter Chips & Sorters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-faint font-mono mr-1">Language:</span>
            {['all', 'typescript', 'rust', 'go', 'python', 'javascript'].map((lang) => (
              <button
                key={lang}
                onClick={() => selectLanguage(lang)}
                className={`px-3 py-1 rounded-lg capitalize font-medium transition-all ${
                  activeLanguage === lang
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                    : 'bg-base text-ink-soft hover:text-ink border border-line hover:border-line-strong'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-ink-faint font-mono">Sort:</span>
            {(['stars', 'forks', 'updated'] as const).map((order) => (
              <button
                key={order}
                onClick={() => {
                  sortOrder = order;
                  searchResults.refresh();
                }}
                className={`px-2.5 py-1 rounded-lg capitalize font-mono text-[11px] transition-all ${
                  sortOrder === order
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                    : 'bg-base text-ink-soft border border-line'
                }`}
              >
                {order}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Container with Sibling Directives */}
      <div if={searchResults.pending && !searchResults.data} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((idx) => (
          <div key={idx} className="h-40 rounded-2xl bg-surface border border-line animate-pulse p-5 flex flex-col justify-between">
            <div className="h-4 bg-elevated rounded w-3/4"></div>
            <div className="h-3 bg-elevated rounded w-full"></div>
            <div className="h-3 bg-elevated rounded w-1/2"></div>
          </div>
        ))}
      </div>

      <div else-if={!!searchResults.error && !searchResults.data} className="p-8 rounded-2xl bg-rose-950/30 border border-rose-800/60 text-rose-300 text-center">
        <span className="text-3xl block mb-2">⚠️</span>
        <h3 className="font-bold text-base mb-1">GitHub API Query Failed</h3>
        <p className="text-xs text-rose-400 mb-4 max-w-md mx-auto">{searchResults.error?.message}</p>
        <button
          onClick={() => searchResults.refresh()}
          className="px-4 py-2 rounded-xl bg-rose-900 hover:bg-rose-800 text-rose-100 text-xs font-semibold"
        >
          Try Again
        </button>
      </div>

      <div else className="space-y-4">
        <div className="flex items-center justify-between text-xs text-ink-soft font-mono px-1">
          <span>Found {searchResults.data?.total_count.toLocaleString() ?? 0} matches</span>
          <span>Showing top {searchResults.data?.items.length ?? 0} results</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {searchResults.data?.items.map((repo) => (
            <div
              key={repo.id}
              className="p-5 rounded-2xl bg-surface border border-line hover:border-emerald-700/50 hover:bg-elevated transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center gap-2 mb-2.5">
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

                <p className="text-xs text-ink-soft mt-2 line-clamp-2 leading-relaxed">
                  {repo.description ?? 'No description available for this repository.'}
                </p>
              </div>

              <div className="mt-5 pt-3 border-t border-line flex items-center justify-between text-xs font-mono text-ink-soft">
                <span className="flex items-center gap-1 text-amber-400 font-semibold">
                  ★ {(repo.stargazers_count / 1000).toFixed(1)}k
                </span>
                <span if={!!repo.language} className="px-2 py-0.5 rounded bg-base text-ink-soft border border-line">
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

    </main>
  );
}
