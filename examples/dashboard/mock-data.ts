export interface Metric {
  id: string;
  label: string;
  value: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export const INITIAL_METRICS: Metric[] = [
  { id: 'cpu', label: 'CPU Utilization', value: 42, unit: '%', trend: 'up' },
  { id: 'memory', label: 'Memory Usage', value: 3.8, unit: 'GB', trend: 'stable' },
  { id: 'requests', label: 'Requests / sec', value: 1250, unit: 'req/s', trend: 'up' },
  { id: 'latency', label: 'Avg Latency', value: 18, unit: 'ms', trend: 'down' },
];
