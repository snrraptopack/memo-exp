/**
 * @fileoverview Performance benchmarks for @memoized-dom/router hotpaths.
 *
 * Measures:
 * 1. matchRoutePattern throughput (static, 1-param, multi-param, wildcard, large trees)
 * 2. buildRoutePath parameter interpolation & query string serialization
 * 3. createRouteQuery read operations
 * 4. In-memory navigate() and changing-parameter transition throughput
 */

import {
  buildRoutePath,
  createRouteQuery,
  createRouteRuntime,
  matchRoutePattern,
} from '@memoized-dom/router';

interface BenchResult {
  name: string;
  iterations: number;
  nsPerOp: number;
  opsPerSec: number;
}

const WARMUP_MS = 200;
const MEASURE_MS = 1000;

function now(): number {
  return performance.now();
}

/** Measures synchronous operation throughput and latency. */
function measureSync(name: string, fn: () => void): BenchResult {
  // 1. Warmup phase to stabilize V8 / JSC TurboFan JIT
  const warmupDeadline = now() + WARMUP_MS;
  while (now() < warmupDeadline) {
    fn();
  }

  // 2. Timed measurement phase
  let iterations = 0;
  const start = now();
  const deadline = start + MEASURE_MS;
  while (now() < deadline) {
    fn();
    iterations++;
  }
  const elapsedSeconds = (now() - start) / 1000;
  const opsPerSec = iterations / elapsedSeconds;
  const nsPerOp = (elapsedSeconds * 1_000_000_000) / iterations;

  return {
    name,
    iterations,
    nsPerOp,
    opsPerSec,
  };
}

// -----------------------------------------------------------------------------
// Benchmark Fixtures & Data Generators
// -----------------------------------------------------------------------------

// Static & Parameterized Path Patterns
const staticPattern = '/settings/billing/invoices';
const staticPath = '/settings/billing/invoices';

const singleParamPattern = '/users/:userId';
const singleParamPath = '/users/usr_9942a';

const deepParamPattern = '/organizations/:orgId/projects/:projectId/builds/:buildId';
const deepParamPath = '/organizations/apex-cloud/projects/compiler-core/builds/bld_7718';

const wildcardPattern = '/docs/*';
const wildcardPath = '/docs/compiler/optimistic-transactions/replacement-chain';

// Dynamic Param Rotating Samples for Cache-Busting Tests
const rotatingUserPaths = Array.from(
  { length: 50 },
  (_, i) => `/users/user_${i}`,
);
let userPathCursor = 0;

// Large Route Set (500 routes)
const largeRouteSet: string[] = [];
for (let section = 0; section < 10; section++) {
  for (let resource = 0; resource < 50; resource++) {
    largeRouteSet.push(`/sec-${section}/res-${resource}/:id`);
  }
}
const needlePath = '/sec-9/res-49/item_12345';

function matchAgainstRouteSet(patterns: string[], pathname: string): unknown {
  for (let i = 0; i < patterns.length; i++) {
    const match = matchRoutePattern(patterns[i]!, pathname);
    if (match !== null) return match;
  }
  return null;
}

// Memory Navigation Setup
const navRuntime = createRouteRuntime();
const navParams = Array.from({ length: 50 }, (_, i) => ({ id: `svc_${i}` }));
let navCursor = 0;

// -----------------------------------------------------------------------------
// Benchmark Execution Suite
// -----------------------------------------------------------------------------

export function runRouterBenchmarks(): void {
  console.log('='.repeat(92));
  console.log('@memoized-dom/router - Hotpath Performance Benchmark');
  console.log('='.repeat(92));

  const results: BenchResult[] = [
    // 1. Path Matching Benchmarks
    measureSync('Static Route Match (exact)', () => {
      matchRoutePattern(staticPattern, staticPath);
    }),

    measureSync('Single Parameter Match (:userId)', () => {
      matchRoutePattern(singleParamPattern, singleParamPath);
    }),

    measureSync('Single Param (rotating inputs)', () => {
      const p = rotatingUserPaths[userPathCursor++ % rotatingUserPaths.length]!;
      matchRoutePattern(singleParamPattern, p);
    }),

    measureSync('Deep 3-Param Match (:org/:proj/:id)', () => {
      matchRoutePattern(deepParamPattern, deepParamPath);
    }),

    measureSync('Wildcard Match (/docs/*)', () => {
      matchRoutePattern(wildcardPattern, wildcardPath);
    }),

    measureSync('Large Route Set Search (500 routes)', () => {
      matchAgainstRouteSet(largeRouteSet, needlePath);
    }),

    // 2. Path Building & Interpolation Benchmarks
    measureSync('buildRoutePath (params only)', () => {
      buildRoutePath(deepParamPattern, {
        orgId: 'apex-cloud',
        projectId: 'core',
        buildId: 'bld_101',
      });
    }),

    measureSync('buildRoutePath (params + query + hash)', () => {
      buildRoutePath(
        deepParamPattern,
        { orgId: 'apex-cloud', projectId: 'core', buildId: 'bld_101' },
        { tab: 'telemetry', page: 2, tag: ['prod', 'v2'] },
        'metrics-graph',
      );
    }),

    // 3. Route Query View & Serialization Benchmarks
    measureSync('createRouteQuery (serialize object)', () => {
      createRouteQuery({ tab: 'logs', page: 3, filter: 'all', tag: ['core', 'edge'] });
    }),

    measureSync('route.query lookups (get / has / getAll)', () => {
      const q = navRuntime.route.query;
      q.get('tab');
      q.has('page');
      q.getAll('tag');
    }),

    // 4. In-Memory Router Navigation Benchmarks
    measureSync('navigate() Static Destination', () => {
      navRuntime.navigate('/settings/billing');
    }),

    measureSync('navigate() Changing Parameters Loop', () => {
      const p = navParams[navCursor++ % navParams.length]!;
      navRuntime.navigate('/services/:id', { params: p });
    }),
  ];

  // Output Formatted Results Table
  console.log(
    'Operation'.padEnd(46) +
    'Iterations'.padStart(14) +
    'Latency / Op'.padStart(16) +
    'Throughput'.padStart(16),
  );
  console.log('-'.repeat(92));

  for (const res of results) {
    const formattedOps =
      res.opsPerSec >= 1_000_000
        ? `${(res.opsPerSec / 1_000_000).toFixed(2)}M ops/s`
        : `${(res.opsPerSec / 1_000).toFixed(2)}k ops/s`;

    const formattedNs =
      res.nsPerOp < 1_000
        ? `${res.nsPerOp.toFixed(1)} ns`
        : `${(res.nsPerOp / 1_000).toFixed(2)} μs`;

    console.log(
      res.name.padEnd(46) +
      res.iterations.toLocaleString().padStart(14) +
      formattedNs.padStart(16) +
      formattedOps.padStart(16),
    );
  }

  console.log('='.repeat(92));
}

// Execute benchmark runner
runRouterBenchmarks();
