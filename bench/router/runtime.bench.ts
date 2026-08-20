import { bench, describe } from 'vitest';
import { createRouteRuntime } from '@memoized-dom/router';
import type {
  RouteLocationSnapshot,
  RouteMatch,
  RoutePatternDefinition,
} from '@memoized-dom/router';
import {
  consume,
  invariant,
  readBenchmarkSink,
  ROUTER_BENCH_OPTIONS,
} from './shared';

const routes: readonly RoutePatternDefinition[] = [
  { id: 'root', pattern: '/' },
  { id: 'posts', pattern: '/posts' },
  { id: 'post-detail', pattern: '/posts/:id' },
  { id: 'about', pattern: '/about' },
  { id: 'services', pattern: '/services/:id' },
  { id: 'search', pattern: '/search' },
];
const hrefs = ['/', '/posts', '/posts/42', '/about'] as const;
const postParams = Array.from({ length: 64 }, (_, index) => ({ id: `post-${index}` }));
const searchQueries = Array.from({ length: 64 }, (_, index) => ({
  q: `router query ${index}`,
  page: index + 1,
  tag: ['router', `section-${index}`],
}));

function createPureRuntime() {
  return createRouteRuntime({ environment: {}, routes });
}

function nestedResolver(location: RouteLocationSnapshot): readonly RouteMatch[] {
  const segments = location.pathname.split('/');
  const orgId = segments[2];
  const projectId = segments[4];
  const buildId = segments[6];
  if (orgId === undefined || projectId === undefined || buildId === undefined) return [];
  return [
    {
      id: 'organization',
      pattern: '/organizations/:orgId',
      pathname: `/organizations/${orgId}`,
      params: { orgId },
    },
    {
      id: 'project',
      pattern: '/projects/:projectId',
      pathname: `/organizations/${orgId}/projects/${projectId}`,
      params: { projectId },
    },
    {
      id: 'build',
      pattern: '/builds/:buildId',
      pathname: location.pathname,
      params: { buildId },
    },
  ];
}

const directRuntime = createPureRuntime();
const noSubscriberRuntime = createPureRuntime();
const typedRuntime = createPureRuntime();
const oneSubscriberRuntime = createPureRuntime();
const fiveSubscriberRuntime = createPureRuntime();
const signalRuntime = createPureRuntime();
const queryRuntime = createPureRuntime();
const sameLocationRuntime = createPureRuntime();
const nestedRuntime = createRouteRuntime({ environment: {}, resolver: nestedResolver });

let oneSubscriberReads = 0;
oneSubscriberRuntime.subscribe(snapshot => {
  oneSubscriberReads += snapshot.pathname.length;
});
let fiveSubscriberReads = 0;
for (let index = 0; index < 5; index++) {
  fiveSubscriberRuntime.subscribe(snapshot => {
    fiveSubscriberReads += snapshot.pathname.length + index;
  });
}

sameLocationRuntime.navigate('/posts');
invariant(sameLocationRuntime.route.pathname === '/posts', 'same-location runtime setup');
nestedRuntime.setLocation('/organizations/acme/projects/compiler/builds/42');
invariant(nestedRuntime.route.matches.length === 3, 'nested resolver chain');
invariant(nestedRuntime.route.params.projectId === 'compiler', 'nested merged parameters');

let directCursor = 0;
let hrefCursor = 0;
let typedCursor = 0;
let oneSubscriberCursor = 0;
let fiveSubscriberCursor = 0;
let signalCursor = 0;
let queryCursor = 0;
let nestedCursor = 0;

describe('route runtime transactions', () => {
  bench('setLocation warm varied: resolve without path building', () => {
    const path = hrefs[directCursor++ % hrefs.length]!;
    directRuntime.setLocation(path, 'push');
    consume(directRuntime.route.matched);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate cached: same-location no-op', () => {
    sameLocationRuntime.navigate('/posts');
    consume(sameLocationRuntime.route.pathname);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate warm varied: href, no subscribers', () => {
    const path = hrefs[hrefCursor++ % hrefs.length]!;
    noSubscriberRuntime.navigate(path);
    consume(noSubscriberRuntime.route.matched);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate warm varied: typed parameter, no subscribers', () => {
    const params = postParams[typedCursor++ % postParams.length]!;
    typedRuntime.navigate('/posts/:id', { params });
    consume(typedRuntime.route.params.id);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate warm varied: one snapshot subscriber', () => {
    const params = postParams[oneSubscriberCursor++ % postParams.length]!;
    oneSubscriberRuntime.navigate('/posts/:id', { params });
    consume(oneSubscriberReads);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate warm varied: five snapshot subscribers', () => {
    const params = postParams[fiveSubscriberCursor++ % postParams.length]!;
    fiveSubscriberRuntime.navigate('/posts/:id', { params });
    consume(fiveSubscriberReads);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate warm varied: accessed cancellation signal', () => {
    const previousSignal = signalRuntime.route.signal;
    const params = postParams[signalCursor++ % postParams.length]!;
    signalRuntime.navigate('/posts/:id', { params });
    consume(previousSignal.aborted && signalRuntime.route.signal);
  }, ROUTER_BENCH_OPTIONS);

  bench('navigate warm varied: query plus first populated lookup', () => {
    const query = searchQueries[queryCursor++ % searchQueries.length]!;
    queryRuntime.navigate('/search', { query });
    consume([queryRuntime.route.query.get('q'), queryRuntime.route.query.getAll('tag')]);
  }, ROUTER_BENCH_OPTIONS);

  bench('setLocation warm varied: atomic three-match resolver', () => {
    const index = nestedCursor++ & 63;
    nestedRuntime.setLocation(
      `/organizations/org-${index & 7}/projects/project-${index}/builds/build-${index * 11}`,
      'push',
    );
    consume(nestedRuntime.route.params);
  }, ROUTER_BENCH_OPTIONS);

  bench('snapshot: stable runtime state to immutable boundary', () => {
    consume(nestedRuntime.snapshot());
  }, ROUTER_BENCH_OPTIONS);

  bench('runtime cold: construct, initial six-route resolve, dispose', () => {
    const runtime = createPureRuntime();
    consume(runtime.route.matched);
    runtime.dispose();
  }, ROUTER_BENCH_OPTIONS);
});

void readBenchmarkSink;
