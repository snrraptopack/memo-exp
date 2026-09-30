/** One report containing module, component and mixed state placement results. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BenchRow } from './state-placement-browser';
export interface StatePlacementResult {
  measuredAt: string;
  samples: number;
  scheduler: string;
  validation: string;
  rows: BenchRow[];
}
const groups = [
  ['Module state', 'module-component', 'module-inline'],
  ['Component state', 'owner-component', 'owner-inline'],
  ['Mixed state: module data, component selection', 'module-data-component', 'module-data-inline'],
  ['Mixed state: component data, module selection', 'module-selection-component', 'module-selection-inline'],
] as const;
export function writeStatePlacementReport(directory: string, result: StatePlacementResult): string {
  const lines = [
    '# DOM benchmark: module state and component state', '',
    `Measured ${result.measuredAt}. Milliseconds, median of ${result.samples} samples.`, '',
    'Synchronous scheduler. DOM validation runs after every operation outside timing.', '',
  ];
  for (const [title, component, inline] of groups) {
    lines.push(`## ${title}`, '', '| Operation | Component rows | Inline rows | Vanilla |',
      '|---|---:|---:|---:|');
    for (const row of result.rows) lines.push(`| ${row.name} | ${row.timings[component]!.toFixed(2)} | ${row.timings[inline]!.toFixed(2)} | ${row.timings.vanilla!.toFixed(2)} |`);
    lines.push('');
  }
  lines.push('The mixed placements separate data location from selection location. Component-owned selection uses a prop and owner callback for component rows. These timings include those authored paths; vanilla uses direct node references. Small timings approach timer resolution, and a single run does not establish a universal ranking.', '');
  const report = lines.join('\n');
  writeFileSync(join(directory, 'state-placement-latest.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(directory, 'state-placement-results.md'), report);
  return report;
}
