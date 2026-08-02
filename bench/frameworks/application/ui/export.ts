import type { ApplicationScenario } from '../contract';
import type { ApplicationRun } from '../results';
import { frameworks, scenarios } from './catalog';

export interface ExportableLiveResult {
  count: number;
  framework: string;
  heapDeltaBytes: number | null;
  mutationRecords: number;
  p25Ms: number;
  p75Ms: number;
  scenario: ApplicationScenario;
  timeMs: number;
}

export function buildLiveApplicationRun(
  liveResults: readonly ExportableLiveResult[],
  samples: number,
  recordedRun: ApplicationRun | null,
  environment: {
    browser: string;
    date?: string;
    platform: string;
  },
): ApplicationRun {
  return {
    browser: environment.browser,
    config: {
      counts: [...new Set(liveResults.map((result) => result.count))],
      samples,
      scenarios: scenarios.map((scenario) => scenario.id),
      warmup: 1,
    },
    date: environment.date ?? new Date().toISOString(),
    note:
      'Interactive application benchmark; adapters shared one browser ' +
      'dashboard process and every result passed DOM validation.',
    platform: environment.platform,
    results: frameworks.flatMap((framework) => {
      const own = liveResults.filter(
        (result) => result.framework === framework.id,
      );
      if (own.length === 0) return [];
      const recordedFramework = recordedRun?.results.find(
        (result) => result.id === framework.id,
      );
      return [{
        bundle: recordedFramework?.bundle ?? {
          gzipBytes: 0,
          rawBytes: 0,
        },
        id: framework.id,
        label: framework.label,
        measurements: own.map((result) => ({
          count: result.count,
          heapDeltaBytes: result.heapDeltaBytes,
          mutationRecords: result.mutationRecords,
          nsPerOperation: result.timeMs * 1_000_000,
          p25NsPerOperation: result.p25Ms * 1_000_000,
          p75NsPerOperation: result.p75Ms * 1_000_000,
          scenario: result.scenario,
        })),
        version: recordedFramework?.version ?? 'live',
      }];
    }),
  };
}

export function downloadApplicationRun(run: ApplicationRun): void {
  const blob = new Blob([`${JSON.stringify(run, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    `application-benchmark-live-${run.date.replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
