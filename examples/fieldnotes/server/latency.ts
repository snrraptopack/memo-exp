/** Simulated network/db latency so loading states are visible. */
export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
