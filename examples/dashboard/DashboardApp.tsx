import { INITIAL_METRICS, type Metric, type LogEntry } from './mock-data';
import { MetricCard } from './MetricCard';
import { SystemLogs } from './SystemLogs';

export function DashboardApp() {
  // Component-Local State (R12 - Instance Closure State)
  let metrics: Metric[] = [...INITIAL_METRICS];
  let logs: LogEntry[] = [
    { id: 1, timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'System initialized successfully' },
    { id: 2, timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Connected to real-time event stream' },
  ];
  let isLive = true;
  let activeTab = 'overview';

  // Local Derivations (R14 - Owner Update Prologue Replay)
  const avgLatency = metrics.find((m) => m.id === 'latency')?.value ?? 0;
  const systemStatus = avgLatency > 50 ? 'DEGRADED' : 'HEALTHY';

  // Effect with Teardown / Cleanup
  effect(() => {
    if (!isLive) return;

    const timer = setInterval(() => {
      // Simulate live metric ticks
      metrics = metrics.map((m) => {
        const delta = (Math.random() - 0.48) * 4;
        const newValue = Math.max(1, Math.round((m.value + delta) * 10) / 10);
        return {
          ...m,
          value: newValue,
          trend: delta > 0 ? 'up' : 'down',
        };
      });

      // Periodically push logs
      if (Math.random() > 0.5) {
        const levels: Array<'info' | 'warn' | 'error'> = ['info', 'info', 'warn', 'error'];
        const level = levels[Math.floor(Math.random() * levels.length)]!;
        const newLog: LogEntry = {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          level,
          message: `Telemetry update tick [${level.toUpperCase()}]`,
        };
        logs = [newLog, ...logs.slice(0, 19)];
      }
    }, 1500);

    // Teardown disposer: runs on cleanup or when isLive toggles off
    return () => clearInterval(timer);
  });

  const handleToggleLive = () => {
    isLive = !isLive;
  };

  const handleClearLogs = () => {
    logs = [];
  };

  return (
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div class="title-group">
          <h1>⚡ Real-Time System Dashboard</h1>
          <span class={`status-badge ${systemStatus.toLowerCase()}`}>
            Status: {systemStatus}
          </span>
        </div>

        <div class="header-controls">
          <button
            class={`live-toggle-btn ${isLive ? 'active' : ''}`}
            onClick={handleToggleLive}
          >
            {isLive ? '🟢 Live Updates ON' : '🔴 Updates Paused'}
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav class="dashboard-tabs">
        <button
          class={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => { activeTab = 'overview'; }}
        >
          Overview & Metrics
        </button>
        <button
          class={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => { activeTab = 'logs'; }}
        >
          System Event Logs ({logs.length})
        </button>
      </nav>

      <main class="dashboard-content">
        {activeTab === 'overview' ? (
          <div class="overview-grid">
            {metrics.map((m) => (
              <MetricCard key={m.id} title={m.label} subtitle={m.trend.toUpperCase()}>
                <div class="metric-value">
                  <span class="num">{m.value}</span>
                  <span class="unit">{m.unit}</span>
                </div>
              </MetricCard>
            ))}
          </div>
        ) : (
          <SystemLogs logs={logs} onClear={handleClearLogs} />
        )}
      </main>
    </div>
  );
}
