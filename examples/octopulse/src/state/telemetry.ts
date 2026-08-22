/**
 * Telemetry & System Health State
 * 
 * Demonstrates:
 * 1. Shared module state across multiple views and components
 * 2. Multi-step derived calculation chains (e.g. errorCount -> healthScore -> healthBadge)
 * 3. Module actions that can be triggered from buttons or timers
 */

export let requestsPerSecond = 142;
export let activeWorkers = 8;
export let avgLatencyMs = 28;
export let errorCount = 2;
export let totalOperations = 48290;

/**
 * Derived calculation: Overall health score (0-100)
 */
export const healthScore = Math.max(
  10,
  Math.min(100, Math.round(100 - (errorCount * 3.5) - (avgLatencyMs > 50 ? (avgLatencyMs - 50) : 0)))
);

/**
 * Multi-step derived state: Status label based on health score
 */
export const healthStatusLabel = 
  healthScore >= 90 ? 'Optimal' : healthScore >= 75 ? 'Degraded' : 'Critical';

/**
 * Derived CSS color badge class based on status
 */
export const healthColorClass =
  healthScore >= 90
    ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
    : healthScore >= 75
    ? 'text-amber-400 bg-amber-950/60 border-amber-800/60'
    : 'text-rose-400 bg-rose-950/60 border-rose-800/60';

/**
 * Formatted operations string
 */
export const formattedOperations = totalOperations.toLocaleString();

/**
 * Action: Record incoming real-time operation
 */
export function recordOperation(latency: number = Math.floor(Math.random() * 20 + 20)): void {
  totalOperations++;
  requestsPerSecond = Math.floor(Math.random() * 40 + 130);
  avgLatencyMs = Math.round((avgLatencyMs * 0.9) + (latency * 0.1));
}

/**
 * Action: Simulate an anomaly / error event
 */
export function recordErrorEvent(): void {
  errorCount++;
  recordOperation(85);
}

/**
 * Action: Resolve anomalies / reset errors
 */
export function resolveErrors(): void {
  errorCount = 0;
  avgLatencyMs = 24;
}

/**
 * Action: Scale worker instances
 */
export function adjustWorkers(delta: number): void {
  const next = activeWorkers + delta;
  if (next >= 1 && next <= 32) {
    activeWorkers = next;
  }
}
