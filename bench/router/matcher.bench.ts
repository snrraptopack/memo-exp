import { bench, describe } from 'vitest';
import {
  createRouteMatcher,
  matchRoutePattern,
} from '@memoized-dom/router';
import {
  consume,
  invariant,
  readBenchmarkSink,
  ROUTER_BENCH_OPTIONS,
} from './shared';

const dynamicPattern = '/organizations/:orgId/projects/:projectId/builds/:buildId';
const wildcardPattern = '/docs/*';
const prefixPattern = '/organizations/:orgId';
const variedDynamicPaths = Array.from(
  { length: 64 },
  (_, index) => `/organizations/org-${index & 7}/projects/project-${index}/builds/build-${index * 13}`,
);
const variedWildcardPaths = Array.from(
  { length: 64 },
  (_, index) => `/docs/compiler/section-${index}/page-${index * 3}`,
);
const variedPrefixPaths = Array.from(
  { length: 64 },
  (_, index) => `/organizations/org-${index}/projects/project-${index}`,
);

invariant(
  matchRoutePattern(dynamicPattern, variedDynamicPaths[0]!)?.params.buildId === 'build-0',
  'dynamic pattern match',
);
invariant(
  matchRoutePattern(wildcardPattern, variedWildcardPaths[1]!)?.params['*'] ===
    'compiler/section-1/page-3',
  'wildcard pattern match',
);

function routeDefinitions(count: number, prefix = ''): string[] {
  return Array.from(
    { length: count },
    (_, index) => `/${prefix}section-${Math.floor(index / 50)}/resource-${index}/:id`,
  );
}

function routeNeedles(count: number, prefix = ''): string[] {
  return Array.from({ length: 64 }, (_, index) => {
    const routeIndex = (index * 17) % count;
    return `/${prefix}section-${Math.floor(routeIndex / 50)}/resource-${routeIndex}/item-${index}`;
  });
}

const definitions10 = routeDefinitions(10, 'small-');
const definitions100 = routeDefinitions(100, 'medium-');
const definitions500 = routeDefinitions(500, 'large-');
const definitions1000 = routeDefinitions(1_000, 'xlarge-');
const matcher10 = createRouteMatcher(definitions10);
const matcher100 = createRouteMatcher(definitions100);
const matcher500 = createRouteMatcher(definitions500);
const matcher1000 = createRouteMatcher(definitions1000);
const needles10 = routeNeedles(10, 'small-');
const needles100 = routeNeedles(100, 'medium-');
const needles500 = routeNeedles(500, 'large-');
const needles1000 = routeNeedles(1_000, 'xlarge-');
const misses500 = Array.from({ length: 64 }, (_, index) => `/large-missing/${index}/route`);
const cachedNeedle500 = needles500[0]!;
matcher500.match(cachedNeedle500);

invariant(matcher10.match(needles10[3]!) !== null, '10-route lookup');
invariant(matcher500.match(needles500[31]!) !== null, '500-route lookup');
invariant(matcher500.match(misses500[0]!) === null, '500-route miss');

let dynamicCursor = 0;
let wildcardCursor = 0;
let prefixCursor = 0;
let needle10Cursor = 0;
let needle100Cursor = 0;
let needle500Cursor = 0;
let needle1000Cursor = 0;
let miss500Cursor = 0;

describe('single-pattern matching', () => {
  const cachedStaticPattern = '/settings/billing/invoices';
  matchRoutePattern(cachedStaticPattern, cachedStaticPattern);

  bench('pattern cached: static exact last result', () => {
    consume(matchRoutePattern(cachedStaticPattern, cachedStaticPattern));
  }, ROUTER_BENCH_OPTIONS);

  bench('pattern warm: rotating dynamic paths', () => {
    const path = variedDynamicPaths[dynamicCursor++ % variedDynamicPaths.length]!;
    consume(matchRoutePattern(dynamicPattern, path));
  }, ROUTER_BENCH_OPTIONS);

  bench('pattern warm: rotating wildcard paths', () => {
    const path = variedWildcardPaths[wildcardCursor++ % variedWildcardPaths.length]!;
    consume(matchRoutePattern(wildcardPattern, path));
  }, ROUTER_BENCH_OPTIONS);

  bench('pattern warm: rotating prefix layout paths', () => {
    const path = variedPrefixPaths[prefixCursor++ % variedPrefixPaths.length]!;
    consume(matchRoutePattern(prefixPattern, path, { end: false }));
  }, ROUTER_BENCH_OPTIONS);
});

describe('route-table matching', () => {
  bench('trie cached: 500 routes, same last pathname', () => {
    consume(matcher500.match(cachedNeedle500));
  }, ROUTER_BENCH_OPTIONS);

  bench('trie warm varied: 10-route table', () => {
    consume(matcher10.match(needles10[needle10Cursor++ % needles10.length]!));
  }, ROUTER_BENCH_OPTIONS);

  bench('trie warm varied: 100-route table', () => {
    consume(matcher100.match(needles100[needle100Cursor++ % needles100.length]!));
  }, ROUTER_BENCH_OPTIONS);

  bench('trie warm varied: 500-route table', () => {
    consume(matcher500.match(needles500[needle500Cursor++ % needles500.length]!));
  }, ROUTER_BENCH_OPTIONS);

  bench('trie warm varied: 1000-route table', () => {
    consume(matcher1000.match(needles1000[needle1000Cursor++ % needles1000.length]!));
  }, ROUTER_BENCH_OPTIONS);

  bench('trie warm varied: 500-route misses', () => {
    consume(matcher500.match(misses500[miss500Cursor++ % misses500.length]!));
  }, ROUTER_BENCH_OPTIONS);

  bench('trie construction: 500 routes with warm validation cache', () => {
    consume(createRouteMatcher(definitions500));
  }, ROUTER_BENCH_OPTIONS);
});

void readBenchmarkSink;
