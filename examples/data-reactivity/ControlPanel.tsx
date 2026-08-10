import { serverConfig, resetDatabase } from './mock-server';

interface ControlPanelProps {
  onRefresh: () => void;
  onAbort: () => void;
  onClearCache: () => void;
  onConfigChange: () => void;
}

export function ControlPanel({
  onRefresh,
  onAbort,
  onClearCache,
  onConfigChange,
}: ControlPanelProps) {
  return (
    <section class="control-panel">
      <div class="control-panel-group">
        <span class="control-panel-title">🛠️ Data Layer & Reactivity Simulator</span>
        <p class="control-panel-desc">
          Test Memoized DOM's <code>$fetch</code> identity sharing, optimistic mutation rollbacks, and frame reactivity.
        </p>
      </div>

      <div class="control-panel-options">
        <div class="control-item">
          <label for="latency-slider">Network Latency: <strong>{serverConfig.latencyMs}ms</strong></label>
          <input
            id="latency-slider"
            type="range"
            min="0"
            max="2000"
            step="50"
            value={serverConfig.latencyMs}
            onInput={(e: Event) => {
              serverConfig.latencyMs = Number((e.target as HTMLInputElement).value);
              onConfigChange();
            }}
          />
        </div>

        <div class="control-item">
          <label class="toggle-label" title="When enabled, server returns HTTP 500 to test optimistic rollback">
            <input
              type="checkbox"
              checked={serverConfig.shouldFail}
              onChange={(e: Event) => {
                serverConfig.shouldFail = (e.target as HTMLInputElement).checked;
                onConfigChange();
              }}
            />
            <span class="toggle-custom"></span>
            Simulate Server Failure (HTTP 500 Error)
          </label>
        </div>

        <div class="control-actions">
          <button class="btn-ctrl btn-refresh" onClick={onRefresh} title="Call resource.refresh()">
            🔄 Manual Refresh
          </button>
          <button class="btn-ctrl btn-abort" onClick={onAbort} title="Call resource.abort()">
            🛑 Abort Request
          </button>
          <button class="btn-ctrl btn-clear" onClick={onClearCache} title="Clear internal store cache">
            🧹 Clear Cache
          </button>
          <button
            class="btn-ctrl btn-reset"
            onClick={() => {
              resetDatabase();
              onRefresh();
            }}
            title="Restore default mock task data"
          >
            ↩ Reset Data
          </button>
        </div>
      </div>
    </section>
  );
}
