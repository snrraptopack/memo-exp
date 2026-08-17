import type { Channel } from '../types';
import { serverConfig, resetDatabase } from '../mock-server';

interface ChatHeaderProps {
  channel: Channel | undefined;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  onConfigChange: () => void;
}

export function ChatHeader({
  channel,
  searchQuery,
  onSearchChange,
  onRefresh,
  onConfigChange,
}: ChatHeaderProps) {
  return (
    <header class="chat-header">
      <div class="header-main-row">
        <div class="header-channel-meta">
          <div class="header-title-wrap">
            <span class="header-hash">
              {channel?.isPrivate ? '🔒' : '#'}
            </span>
            <h1 class="header-channel-title">
              {channel?.name ?? 'general'}
            </h1>
          </div>
          <span class="header-channel-topic">
            {channel?.topic ?? 'Workspace Channel'}
          </span>
        </div>

        <div class="header-actions">
          {/* Search Box */}
          <div class="search-input-wrap">
            <span class="search-icon">🔍</span>
            <input
              type="text"
              class="search-input"
              placeholder="Search messages..."
              value={searchQuery}
              onInput={(e: Event) =>
                onSearchChange((e.target as HTMLInputElement).value)
              }
            />
            {searchQuery ? (
              <button
                class="search-clear-btn"
                onClick={() => onSearchChange('')}
              >
                ✕
              </button>
            ) : null}
          </div>

          <div class="header-stat-pill">
            <span>👥 {channel?.memberCount ?? 1} members</span>
          </div>
        </div>
      </div>

      {/* Network & Reactivity Simulation Controls */}
      <div class="simulation-banner">
        <div class="sim-pill-group">
          <span class="sim-badge">DATA RUNTIME</span>

          <label class="sim-control-label">
            Latency: <strong>{serverConfig.latencyMs}ms</strong>
            <input
              type="range"
              class="sim-slider"
              min="0"
              max="1500"
              step="50"
              value={serverConfig.latencyMs}
              onInput={(e: Event) => {
                serverConfig.latencyMs = Number(
                  (e.target as HTMLInputElement).value,
                );
                onConfigChange();
              }}
            />
          </label>

          <label class="sim-toggle-label" title="When enabled, server rejects actions with HTTP 500 to test optimistic rollback">
            <input
              type="checkbox"
              checked={serverConfig.shouldFail}
              onChange={(e: Event) => {
                serverConfig.shouldFail = (
                  e.target as HTMLInputElement
                ).checked;
                onConfigChange();
              }}
            />
            <span class="sim-toggle-text">Simulate HTTP 500 Failure</span>
          </label>
        </div>

        <div class="sim-buttons">
          <button
            class="btn-sim"
            onClick={onRefresh}
            title="Trigger resource.refresh()"
          >
            🔄 Refresh
          </button>
          <button
            class="btn-sim"
            onClick={() => {
              resetDatabase();
              onRefresh();
            }}
            title="Reset to default seed data"
          >
            ↩ Reset Data
          </button>
        </div>
      </div>
    </header>
  );
}
