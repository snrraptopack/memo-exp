import { bench, describe } from 'vitest';
import {
  createRouteQuery,
  parseRouteQuery,
} from '@memoized-dom/router';
import {
  consume,
  invariant,
  readBenchmarkSink,
  ROUTER_BENCH_OPTIONS,
} from './shared';

const cleanEncodeSamples = [
  { token: 'foo', page: 12, q: 'hello', flag: true },
  { token: 'bar', page: 3, q: 'router', flag: false },
  { token: 'baz', page: 99, q: 'compiler', flag: true },
  { token: 'qux', page: 1, q: 'runtime', flag: false },
  { token: 'zip', page: 42, q: 'navigation', flag: true },
  { token: 'zap', page: 7, q: 'benchmark', flag: false },
] as const;

const escapedEncodeSamples = [
  { q: 'hello world', tag: ['router', 'aot'], empty: '', omitted: undefined },
  { q: 'compiler/runtime', tag: ['dom & data', 'v1'], empty: '', omitted: null },
  { q: 'São Tomé', tag: ['route#one', 'route?two'], empty: '', page: 2 },
  { q: 'a+b=c', tag: ['alpha beta', 'gamma/delta'], empty: '', debug: false },
] as const;

const cachedEncodeInput = Object.freeze({ ...cleanEncodeSamples[0] });
const cachedEncoded = createRouteQuery(cachedEncodeInput);
const cleanEncodedSamples = cleanEncodeSamples.map(createRouteQuery);
const escapedEncodedSamples = escapedEncodeSamples.map(createRouteQuery);

invariant(cachedEncoded === '?flag=true&page=12&q=hello&token=foo', 'stable clean encoding');
invariant(
  createRouteQuery(escapedEncodeSamples[0]).includes('q=hello+world'),
  'space encoding',
);
invariant(
  parseRouteQuery('?tag=router&tag=aot').tag instanceof Array,
  'repeated-key decoding',
);

let cleanEncodeCursor = 0;
let escapedEncodeCursor = 0;
let cleanDecodeCursor = 0;
let escapedDecodeCursor = 0;

describe('query serialization', () => {
  bench('encode cached: same input reference', () => {
    consume(createRouteQuery(cachedEncodeInput));
  }, ROUTER_BENCH_OPTIONS);

  bench('encode warm: rotating clean primitive values', () => {
    const sample = cleanEncodeSamples[cleanEncodeCursor++ % cleanEncodeSamples.length]!;
    consume(createRouteQuery(sample));
  }, ROUTER_BENCH_OPTIONS);

  bench('encode warm: rotating escaped and repeated values', () => {
    const sample = escapedEncodeSamples[escapedEncodeCursor++ % escapedEncodeSamples.length]!;
    consume(createRouteQuery(sample));
  }, ROUTER_BENCH_OPTIONS);
});

describe('query parsing', () => {
  const cachedDecodeInput = cleanEncodedSamples[0]!;
  parseRouteQuery(cachedDecodeInput);

  bench('decode cached: same search string', () => {
    consume(parseRouteQuery(cachedDecodeInput));
  }, ROUTER_BENCH_OPTIONS);

  bench('decode warm: rotating clean search strings', () => {
    const sample = cleanEncodedSamples[cleanDecodeCursor++ % cleanEncodedSamples.length]!;
    consume(parseRouteQuery(sample));
  }, ROUTER_BENCH_OPTIONS);

  bench('decode warm: rotating escaped and repeated search strings', () => {
    const sample = escapedEncodedSamples[escapedDecodeCursor++ % escapedEncodedSamples.length]!;
    consume(parseRouteQuery(sample));
  }, ROUTER_BENCH_OPTIONS);
});

void readBenchmarkSink;
