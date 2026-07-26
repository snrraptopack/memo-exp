/**
 * Production benchmark for explicit cleanup registration and entity teardown.
 *
 * Setup runs outside the timed interval. Each sample measures only unregister
 * work against the real kernel and cleanup ownership table.
 */

import { performance } from 'node:perf_hooks';
import { cleanup } from '@memoized-dom/runtime';
import { register, unregister } from '@memoized-dom/runtime';

interface Scenario {
  name: string;
  shape: 'flat' | 'subtree';
  disposers: number;
}

const ENTITY_COUNT = 20_000;
const SAMPLE_COUNT = 11;
let sink = 0;

function benchmarkDisposer(): void {
  sink++;
}

const scenarios: Scenario[] = [
  { name: 'flat, no cleanup', shape: 'flat', disposers: 0 },
  { name: 'flat, 1 disposer', shape: 'flat', disposers: 1 },
  { name: 'flat, 4 disposers', shape: 'flat', disposers: 4 },
  { name: 'subtree, no cleanup', shape: 'subtree', disposers: 0 },
  { name: 'subtree, 1 disposer', shape: 'subtree', disposers: 1 },
  { name: 'subtree, 4 disposers', shape: 'subtree', disposers: 4 },
];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function setup(
  prefix: string,
  shape: Scenario['shape'],
  disposerCount: number,
): string[] {
  const roots: string[] = [];
  if (shape === 'subtree') {
    register({ id: prefix, parent: null, render() {} });
    roots.push(prefix);
  }

  for (let i = 0; i < ENTITY_COUNT; i++) {
    const id = shape === 'flat' ? `${prefix}-${i}` : `${prefix}/${i}`;
    register({
      id,
      parent: shape === 'flat' ? null : prefix,
      render() {},
    });
    if (shape === 'flat') roots.push(id);
    for (let d = 0; d < disposerCount; d++) {
      cleanup(id, benchmarkDisposer);
    }
  }
  return roots;
}

function measure(scenario: Scenario, sample: number): number {
  const prefix = `Lifecycle-${scenario.shape}-${scenario.disposers}-${sample}`;
  const roots = setup(prefix, scenario.shape, scenario.disposers);
  Bun.gc(true);
  const start = performance.now();
  for (const root of roots) unregister(root);
  const elapsed = performance.now() - start;
  return (elapsed * 1_000_000) / ENTITY_COUNT;
}

console.log(
  `\nLIFECYCLE OWNERSHIP (production runtime, ${ENTITY_COUNT.toLocaleString()} entities, median of ${SAMPLE_COUNT})\n`,
);
console.log('scenario'.padEnd(28), 'teardown/entity'.padStart(18));
console.log('-'.repeat(47));
for (const scenario of scenarios) {
  measure(scenario, -1);
  const samples = Array.from({ length: SAMPLE_COUNT }, (_, sample) =>
    measure(scenario, sample),
  );
  console.log(
    scenario.name.padEnd(28),
    `${median(samples).toFixed(1)}ns`.padStart(18),
  );
}
console.log(`\nobservable disposer checksum: ${sink}`);
