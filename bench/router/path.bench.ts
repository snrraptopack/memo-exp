import { bench, describe } from 'vitest';
import {
  buildRoutePath,
  joinRoutePaths,
  normalizeRoutePath,
} from '@memoized-dom/router';
import {
  consume,
  invariant,
  readBenchmarkSink,
  ROUTER_BENCH_OPTIONS,
} from './shared';

const cachedCleanPath = '/settings/billing/invoices';
const cachedTrimmedPath = '///settings/billing/invoices/?tab=active#summary';
invariant(normalizeRoutePath(cachedCleanPath) === cachedCleanPath, 'clean normalization');
invariant(
  normalizeRoutePath(cachedTrimmedPath) === '/settings/billing/invoices',
  'trim/query/hash normalization',
);

// Saturate the bounded map so rotating samples below continue to exercise the
// normalization implementation after Tinybench warm-up instead of becoming map hits.
for (let index = 0; index < 4_096; index++) {
  normalizeRoutePath(`/__router-benchmark-cache-fill/${index}`);
}

const normalizedMissSamples = Array.from(
  { length: 128 },
  (_, index) => `/bench-clean/section-${index}/resource-${index}`,
);
const trimmedMissSamples = Array.from(
  { length: 128 },
  (_, index) => `///bench-trim/section-${index}/resource-${index}/?tab=${index}#result`,
);
invariant(
  normalizeRoutePath(trimmedMissSamples[7]!) === '/bench-trim/section-7/resource-7',
  'rotating trimmed normalization',
);

const joinSamples = Array.from({ length: 32 }, (_, index) => ({
  parent: `/organizations/:organizationId/area-${index}`,
  child: `/projects/:projectId/view-${index}`,
}));
invariant(
  joinRoutePaths('/organizations/:organizationId', '/projects/:projectId') ===
    '/organizations/:organizationId/projects/:projectId',
  'nested path composition',
);

const deepPattern = '/organizations/:orgId/projects/:projectId/builds/:buildId';
const variedParams = Array.from({ length: 64 }, (_, index) => ({
  orgId: `org-${index & 7}`,
  projectId: `project-${index}`,
  buildId: `build-${index * 17}`,
}));
const escapedParams = Array.from({ length: 32 }, (_, index) => ({
  orgId: `São Tomé ${index}`,
  projectId: `compiler/runtime ${index}`,
  buildId: `build#${index}`,
}));
const wildcardParams = Array.from({ length: 32 }, (_, index) => ({
  '*': `compiler/section ${index}/page-${index}`,
}));
const cachedParams = variedParams[0]!;
const cachedQuery = { tab: 'telemetry', tag: ['router', 'aot'] } as const;
const cachedBuiltPath = buildRoutePath(deepPattern, cachedParams, cachedQuery, 'metrics');
invariant(cachedBuiltPath.endsWith('?tab=telemetry&tag=router&tag=aot#metrics'), 'full path build');

let normalizedCursor = 0;
let trimmedCursor = 0;
let joinCursor = 0;
let paramsCursor = 0;
let escapedCursor = 0;
let wildcardCursor = 0;

describe('path normalization and composition', () => {
  bench('normalize cached: same clean pathname', () => {
    consume(normalizeRoutePath(cachedCleanPath));
  }, ROUTER_BENCH_OPTIONS);

  bench('normalize uncached: rotating already-normalized paths', () => {
    const path = normalizedMissSamples[normalizedCursor++ % normalizedMissSamples.length]!;
    consume(normalizeRoutePath(path));
  }, ROUTER_BENCH_OPTIONS);

  bench('normalize uncached: rotating trim/query/hash paths', () => {
    const path = trimmedMissSamples[trimmedCursor++ % trimmedMissSamples.length]!;
    consume(normalizeRoutePath(path));
  }, ROUTER_BENCH_OPTIONS);

  bench('join warm: rotating validated parent and child patterns', () => {
    const sample = joinSamples[joinCursor++ % joinSamples.length]!;
    consume(joinRoutePaths(sample.parent, sample.child));
  }, ROUTER_BENCH_OPTIONS);
});

describe('path interpolation', () => {
  bench('build cached: same params, query, and hash references', () => {
    consume(buildRoutePath(deepPattern, cachedParams, cachedQuery, 'metrics'));
  }, ROUTER_BENCH_OPTIONS);

  bench('build warm: rotating clean parameters', () => {
    const params = variedParams[paramsCursor++ % variedParams.length]!;
    consume(buildRoutePath(deepPattern, params));
  }, ROUTER_BENCH_OPTIONS);

  bench('build warm: rotating escaped parameters', () => {
    const params = escapedParams[escapedCursor++ % escapedParams.length]!;
    consume(buildRoutePath(deepPattern, params));
  }, ROUTER_BENCH_OPTIONS);

  bench('build warm: rotating wildcard paths', () => {
    const params = wildcardParams[wildcardCursor++ % wildcardParams.length]!;
    consume(buildRoutePath('/docs/*', params));
  }, ROUTER_BENCH_OPTIONS);
});

void readBenchmarkSink;
