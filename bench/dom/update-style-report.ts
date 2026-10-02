import { rowStyles, statePlacements, updateStyles } from './state-placement-matrix';
export interface UpdateStyleRow { name: string; timings: Record<string, number> }
export interface UpdateStyleResult {
  measuredAt: string;
  samples: number;
  rows: UpdateStyleRow[];
}
export function updateStyleReport(result: UpdateStyleResult): string {
  const lines = ['## Mutable and immutable updates', '',
    `Measured ${result.measuredAt}; median of ${result.samples} samples in milliseconds.`, '',
    'Both styles produce the same visible result and preserve retained DOM nodes. Each sample resets a seeded random generator for matching input labels. Timings include state preparation, scheduling and DOM updates; setup and validation are outside timing.', '',
  ];
  for (const placement of statePlacements) {
    lines.push(`### ${placement.title}`, '',
      '| Operation | Component mutable | Component immutable | Inline mutable | Inline immutable |',
      '|---|---:|---:|---:|---:|');
    for (const row of result.rows) {
      const values = rowStyles.flatMap(rows => updateStyles.map(style => {
        const value = row.timings[`${placement.id}-${rows}-${style}`];
        if (value === undefined || !Number.isFinite(value)) throw new Error(`Missing update-style timing: ${placement.id}/${rows}/${style}/${row.name}`);
        return value.toFixed(2);
      }));
      lines.push(`| ${row.name} | ${values.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('Mutable updates edit existing records/arrays. Immutable partial updates replace the array and changed records, retaining untouched record references; immutable swaps map a new array, append uses concat, and removal uses filter. These authored paths require different allocation and iteration work. The results do not establish that either style is universally faster. Selection remains at the same state location for each pair, with row 500 selected before timing.', '');
  return lines.join('\n');
}
