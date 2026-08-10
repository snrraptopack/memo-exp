import { compileModulesDetailed } from '@memoized-dom/compiler';
import { csvCell, writeResult } from '../shared';
import { oracleCases } from './cases';
import { executeOracleCase, type OracleRow } from './execute';

const rows: OracleRow[] = [];
for (const testCase of oracleCases) {
  const compiled = compileModulesDetailed(testCase.modules, {
    runtimePath: '@memoized-dom/runtime',
  });
  rows.push(...await executeOracleCase(testCase, compiled.metadata));
}

const totals = rows.reduce(
  (sum, row) => ({
    truePositives: sum.truePositives + row.truePositives,
    falsePositives: sum.falsePositives + row.falsePositives,
    falseNegatives: sum.falseNegatives + row.falseNegatives,
  }),
  { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
);
const precision = totals.truePositives + totals.falsePositives === 0
  ? 1
  : totals.truePositives / (totals.truePositives + totals.falsePositives);
const recall = totals.truePositives + totals.falseNegatives === 0
  ? 1
  : totals.truePositives / (totals.truePositives + totals.falseNegatives);
const summary = {
  generatedAt: new Date().toISOString(),
  cases: oracleCases.length,
  scenarios: rows.length,
  ...totals,
  precision,
  recall,
  interpretation: 'Dynamic observations are concrete-execution oracles, not whole-program semantic ground truth.',
};

await writeResult('oracle.json', `${JSON.stringify({ summary, rows }, null, 2)}\n`);
await writeResult('oracle.csv', oracleCsv(rows));
await writeResult('oracle.md', oracleMarkdown(rows, summary));
console.log(oracleMarkdown(rows, summary));

function oracleCsv(rows: readonly OracleRow[]): string {
  const header = [
    'case', 'category', 'scenario', 'writes', 'static_selected', 'oracle_observed',
    'changed', 'true_positives', 'false_positives', 'false_negatives', 'precision', 'recall',
  ];
  const values = rows.map((row) => [
    row.case, row.category, row.scenario, row.writes.join(';'),
    row.staticSelected.join(';'), row.oracleObserved.join(';'), row.changed.join(';'),
    row.truePositives, row.falsePositives, row.falseNegatives,
    row.precision.toFixed(4), row.recall.toFixed(4),
  ]);
  return `${[header, ...values].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function oracleMarkdown(
  rows: readonly OracleRow[],
  summary: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
  },
): string {
  return [
    '# Concrete-execution precision/recall oracle',
    '',
    '| Case | Scenario | |S| | |O| | |C| | Precision | Recall |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...rows.map((row) =>
      `| ${row.case} | ${row.scenario} | ${row.staticSelected.length} | ${row.oracleObserved.length} | ${row.changed.length} | ${(100 * row.precision).toFixed(1)}% | ${(100 * row.recall).toFixed(1)}% |`,
    ),
    '',
    `Aggregate: TP=${summary.truePositives}, FP=${summary.falsePositives}, FN=${summary.falseNegatives}, precision=${(100 * summary.precision).toFixed(1)}%, recall=${(100 * summary.recall).toFixed(1)}%.`,
    '',
    'The oracle uses a separate Babel transform plus runtime object-identity logging; it does not reuse memoized-dom read/write extraction. Each scenario compares the compiler selection S with the dependencies observed on that concrete execution O. C is the set of derived outputs whose values changed.',
    '',
  ].join('\n');
}
