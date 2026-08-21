import { bench, describe } from 'vitest';
import {
  createRouteManifest,
  createMemoryRouteHistory,
  createRouteRuntime,
} from '@memoized-dom/router';
import type { RoutePatternDefinition } from '@memoized-dom/router';
import {
  consume,
  invariant,
  readBenchmarkSink,
  ROUTER_BENCH_OPTIONS,
} from './shared';

const nestedDefinitions: readonly RoutePatternDefinition[] = [
  { id: 'root', pattern: '/' },
  { id: 'organizations', parentId: 'root', pattern: '/organizations' },
  { id: 'organization', parentId: 'organizations', pattern: '/:orgId' },
  { id: 'projects', parentId: 'organization', pattern: '/projects' },
  { id: 'project', parentId: 'projects', pattern: '/:projectId' },
  { id: 'builds', parentId: 'project', pattern: '/builds' },
  { id: 'build', parentId: 'builds', pattern: '/:buildId' },
  { id: 'settings', parentId: 'organization', pattern: '/settings' },
  { id: 'missing', parentId: 'root', pattern: '/*' },
];

const manifest = createRouteManifest(nestedDefinitions);
const paths = Array.from(
  { length: 64 },
  (_, index) =>
    `/organizations/org-${index & 7}/projects/project-${index}/builds/build-${index * 13}`,
);
const params = Array.from({ length: 64 }, (_, index) => ({
  orgId: `org-${index & 7}`,
  projectId: `project-${index}`,
  buildId: `build-${index * 13}`,
}));

invariant(manifest.matchAll(paths[0]!).length === 7, 'seven-level manifest match');
invariant(
  manifest.build('build', { params: params[1]! }).endsWith(
    '/organizations/org-1/projects/project-1/builds/build-13',
  ),
  'manifest route-ID build',
);

const history = createMemoryRouteHistory({
  initialEntries: ['/first', '/second'],
});
const historyRuntime = createRouteRuntime({ routeHistory: history });
let matchCursor = 0;
let buildCursor = 0;

describe('nested route manifests', () => {
  bench('manifest warm varied: resolve seven-match chain', () => {
    consume(manifest.matchAll(paths[matchCursor++ % paths.length]!));
  }, ROUTER_BENCH_OPTIONS);

  bench('manifest build warm varied: route ID and three params', () => {
    consume(manifest.build('build', {
      params: params[buildCursor++ % params.length]!,
    }));
  }, ROUTER_BENCH_OPTIONS);

  bench('manifest construction: nine nested definitions, warm path caches', () => {
    consume(createRouteManifest(nestedDefinitions));
  }, ROUTER_BENCH_OPTIONS);
});

describe('router-owned history', () => {
  bench('memory traversal: guarded runtime back and forward', () => {
    const result = history.canGoBack
      ? historyRuntime.back()
      : historyRuntime.forward();
    consume(result);
  }, ROUTER_BENCH_OPTIONS);
});

void readBenchmarkSink;
