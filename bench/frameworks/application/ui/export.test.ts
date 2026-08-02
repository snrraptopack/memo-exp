import { describe, expect, it } from 'vitest';
import { buildLiveApplicationRun } from './export';

describe('application benchmark live export', () => {
  it('builds the persisted ApplicationRun schema with timing ranges', () => {
    const run = buildLiveApplicationRun(
      [
        {
          count: 1000,
          framework: 'memoized-dom',
          heapDeltaBytes: 1024,
          mutationRecords: 4,
          p25Ms: 19,
          p75Ms: 24,
          scenario: 'load',
          timeMs: 21,
        },
        {
          count: 1000,
          framework: 'solid',
          heapDeltaBytes: 2048,
          mutationRecords: 1003,
          p25Ms: 27,
          p75Ms: 32,
          scenario: 'load',
          timeMs: 29,
        },
      ],
      3,
      null,
      {
        browser: 'Test Browser',
        date: '2026-07-30T00:00:00.000Z',
        platform: 'test-platform',
      },
    );

    expect(run.config).toMatchObject({
      counts: [1000],
      samples: 3,
      warmup: 1,
    });
    expect(run.results.map((result) => result.id)).toEqual([
      'memoized-dom',
      'solid',
    ]);
    expect(run.results[0]!.measurements[0]).toMatchObject({
      count: 1000,
      heapDeltaBytes: 1024,
      mutationRecords: 4,
      nsPerOperation: 21_000_000,
      p25NsPerOperation: 19_000_000,
      p75NsPerOperation: 24_000_000,
      scenario: 'load',
    });
    expect(() => JSON.parse(JSON.stringify(run))).not.toThrow();
  });
});
