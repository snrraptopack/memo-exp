/**
 * @fileoverview Vitest Benchmark Suite for @memoized-dom/router hotpaths.
 *
 * Can be run via: vitest bench bench/router/router.bench.ts
 */

import { bench, describe } from 'vitest';
import {
  buildRoutePath,
  createRouteMatcher,
  createRouteQuery,
  createRouteRuntime,
  matchRoutePattern,
  normalizeRoutePath,
  parseRouteQuery,
} from '@memoized-dom/router';

// -----------------------------------------------------------------------------
// Benchmark Fixtures
// -----------------------------------------------------------------------------

const staticPattern = '/settings/billing/invoices';
const staticPath = '/settings/billing/invoices';

const singleParamPattern = '/users/:userId';
const singleParamPath = '/users/usr_9942a';

const deepParamPattern = '/organizations/:orgId/projects/:projectId/builds/:buildId';
const deepParamPath = '/organizations/apex-cloud/projects/compiler-core/builds/bld_7718';

const wildcardPattern = '/docs/*';
const wildcardPath = '/docs/compiler/optimistic-transactions/replacement-chain';

const querySample = {
  tab: 'specs',
  filter: 'available',
  category: 'hardware',
  sort: 'newest',
};

const encodeSamples = [
  { token: 'foo', page: 12, q: 'hello world', flag: true },
  { token: 'bar', page: 3, q: 'router bench', flag: false },
  { token: 'baz', page: 99, q: 'unique value', flag: true },
  { token: 'qux', page: 1, q: 'another query', flag: false },
  { token: 'zip', page: 42, q: 'more text', flag: true },
  { token: 'zap', page: 7, q: 'final sample', flag: false },
];
let sampleCursor = 0;

// Rotating params to prevent monomorphic shortcuts
const rotatingUserPaths = Array.from(
  { length: 50 },
  (_, i) => `/users/user_${i}`,
);
let userPathCursor = 0;

// 500-Route Table Fixture
const largeRouteSet: string[] = [];
for (let section = 0; section < 10; section++) {
  for (let resource = 0; resource < 50; resource++) {
    largeRouteSet.push(`/sec-${section}/res-${resource}/:id`);
  }
}
const needlePath = '/sec-9/res-49/item_12345';
const routeMatcher500 = createRouteMatcher(largeRouteSet);

// In-Memory Navigation Fixture (Auto-Resolved Router)
const navRuntime = createRouteRuntime({
  routes: [
    { id: 'root', pattern: '/' },
    { id: 'posts', pattern: '/posts' },
    { id: 'post-detail', pattern: '/posts/:id' },
    { id: 'about', pattern: '/about' },
    { id: 'services', pattern: '/services/:id' },
    { id: 'users', pattern: '/users/:userId' },
  ],
});
const navPaths = ['/', '/posts', '/posts/42', '/about'];
let navHrefCursor = 0;
const navParams = Array.from({ length: 50 }, (_, i) => ({ id: `svc_${i}` }));
let navParamCursor = 0;

// -----------------------------------------------------------------------------
// Vitest Benchmark Suites
// -----------------------------------------------------------------------------

describe('query string', () => {
  bench('createRouteQuery single sample', () => {
    createRouteQuery(querySample);
  });

  bench('createRouteQuery rotating samples', () => {
    createRouteQuery(encodeSamples[sampleCursor++ % encodeSamples.length]!);
  });

  bench('parseRouteQuery (decode string)', () => {
    parseRouteQuery('?tab=specs&filter=available&category=hardware&sort=newest');
  });

  bench('route.query lookups (get / has / getAll)', () => {
    const q = navRuntime.route.query;
    q.get('tab');
    q.has('page');
    q.getAll('tag');
  });
});

describe('path', () => {
  bench('normalizeRoutePath (clean)', () => {
    normalizeRoutePath('/settings/billing/invoices');
  });

  bench('normalizeRoutePath (messy)', () => {
    normalizeRoutePath('/a//b///c/d//e/');
  });

  bench('buildRoutePath (params only)', () => {
    buildRoutePath(deepParamPattern, {
      orgId: 'apex-cloud',
      projectId: 'core',
      buildId: 'bld_101',
    });
  });

  bench('buildRoutePath (params + query + hash)', () => {
    buildRoutePath(
      deepParamPattern,
      { orgId: 'apex-cloud', projectId: 'core', buildId: 'bld_101' },
      { tab: 'telemetry', page: 2 },
      'metrics',
    );
  });
});

describe('match', () => {
  bench('matchRoutePattern static exact', () => {
    matchRoutePattern(staticPattern, staticPath);
  });

  bench('matchRoutePattern single param (:userId)', () => {
    matchRoutePattern(singleParamPattern, singleParamPath);
  });

  bench('matchRoutePattern single param (rotating)', () => {
    const p = rotatingUserPaths[userPathCursor++ % rotatingUserPaths.length]!;
    matchRoutePattern(singleParamPattern, p);
  });

  bench('matchRoutePattern deep 3-param (:org/:proj/:id)', () => {
    matchRoutePattern(deepParamPattern, deepParamPath);
  });

  bench('matchRoutePattern wildcard (/docs/*)', () => {
    matchRoutePattern(wildcardPattern, wildcardPath);
  });

  bench('createRouteMatcher Trie (500 routes)', () => {
    routeMatcher500.match(needlePath);
  });
});

describe('navigation', () => {
  bench('navigate ({ href })', () => {
    navRuntime.navigate(navPaths[navHrefCursor++ % navPaths.length]!);
  });

  bench('navigate ({ to, params })', () => {
    navRuntime.navigate('/users/:userId', {
      params: { userId: 'usr_42' },
    });
  });

  bench('navigate changing params loop', () => {
    const p = navParams[navParamCursor++ % navParams.length]!;
    navRuntime.navigate('/services/:id', { params: p });
  });
});
