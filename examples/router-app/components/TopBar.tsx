import { navigate, back, forward } from '@memoized-dom/router';

interface TopBarProps {
  currentPath: string;
  onQuickSearch: (query: string) => void;
}

export function TopBar({ currentPath, onQuickSearch }: TopBarProps) {
  function getBreadcrumbSegments(path: string): Array<{ label: string; url: string }> {
    if (path === '/' || path === '/overview') {
      return [{ label: 'Overview', url: '/' }];
    }
    const parts = path.split('/').filter(Boolean);
    const result: Array<{ label: string; url: string }> = [{ label: 'Apex', url: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      result.push({ label: part, url: acc });
    }
    return result;
  }

  const breadcrumbs = getBreadcrumbSegments(currentPath);

  return (
    <header class="app-topbar">
      {/* Top Left: History Buttons & Breadcrumb Trail */}
      <div class="topbar-left">
        <div class="history-controls">
          <button class="btn-icon" onClick={() => back()} title="History Back">
            ←
          </button>
          <button class="btn-icon" onClick={() => forward()} title="History Forward">
            →
          </button>
        </div>

        {/* Dynamic Breadcrumb Bar */}
        <div class="breadcrumbs-list">
          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.url} class="breadcrumb-item">
              {idx > 0 ? <span class="breadcrumb-sep">/</span> : null}
              {idx === breadcrumbs.length - 1 ? (
                <span class="breadcrumb-active">{crumb.label}</span>
              ) : (
                <button
                  class="breadcrumb-button"
                  onClick={() => navigate(crumb.url)}
                >
                  {crumb.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Top Right: Global Search & Live Path Inspector */}
      <div class="topbar-right">
        {/* Quick Search */}
        <div class="quick-search-box">
          <span class="search-symbol">/</span>
          <input
            class="quick-search-input"
            type="text"
            placeholder="Jump to service (e.g. auth, edge, logs)..."
            onInput={(e: Event) =>
              onQuickSearch((e.target as HTMLInputElement).value)
            }
          />
        </div>

        {/* Live URL Pill */}
        <div class="live-url-indicator">
          <span class="url-label">Route:</span>
          <code class="url-code">{currentPath}</code>
        </div>
      </div>
    </header>
  );
}
