import type { LogEntry } from './mock-data';

export interface SystemLogsProps {
  logs: LogEntry[];
  onClear: () => void;
}

export function SystemLogs({ logs, onClear }: SystemLogsProps) {
  return (
    <div class="logs-container">
      <div class="logs-header">
        <h3>Live System Event Stream ({logs.length})</h3>
        <button class="btn-clear" onClick={onClear}>Clear Logs</button>
      </div>
      <ul class="logs-list">
        {logs.map((log) => (
          <li key={log.id} class={`log-item ${log.level}`}>
            <span class="timestamp">[{log.timestamp}]</span>
            <span class="level">{log.level.toUpperCase()}</span>
            <span class="message">{log.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
