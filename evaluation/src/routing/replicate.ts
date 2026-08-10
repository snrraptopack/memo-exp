import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactRoot, csvCell, median, resultsRoot, writeResult } from '../shared';
import type { BenchmarkRow } from './run';

interface AggregateRow extends BenchmarkRow {
  processes: number;
  routeMinNs: number;
  routeMaxNs: number;
  routeCoefficientOfVariation: number;
  constructionMinMs: number;
  constructionMaxMs: number;
}

const processCount = Number(process.env.EVAL_ROUTING_PROCESSES ?? 3);
if (!Number.isInteger(processCount) || processCount < 3) {
  throw new Error('EVAL_ROUTING_PROCESSES must be an integer of at least 3');
}

const processRows: BenchmarkRow[][] = [];
for (let index = 1; index <= processCount; index++) {
  const prefix = `routing-run-${index}`;
  const child = Bun.spawnSync(
    [process.execPath, 'run', '--expose-gc', 'src/routing/run.ts'],
    {
      cwd: artifactRoot,
      env: {
        ...process.env,
        EVAL_ROUTING_PREFIX: prefix,
        EVAL_ROUTING_QUIET: '1',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  );
  if (child.exitCode !== 0) {
    throw new Error(`routing process ${index} failed: ${child.stderr.toString()}`);
  }
  const data = JSON.parse(
    await readFile(join(resultsRoot, `${prefix}.json`), 'utf8'),
  ) as { rows: BenchmarkRow[] };
  processRows.push(data.rows);
  console.log(`routing replicate ${index}/${processCount} complete`);
}

const groups = new Map<string, BenchmarkRow[]>();
for (const rows of processRows) {
  for (const row of rows) {
    const key = `${row.topology}\0${row.kernel}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
}

const aggregated: AggregateRow[] = [...groups.values()].map((samples) => {
  const first = samples[0]!;
  const routes = samples.map((sample) => sample.routeMedianNs);
  const constructions = samples.map((sample) => sample.constructionMs);
  return {
    ...first,
    processes: samples.length,
    constructionMs: median(constructions),
    mountNsPerEntity: median(samples.map((sample) => sample.mountNsPerEntity)),
    unmountNsPerEntity: median(samples.map((sample) => sample.unmountNsPerEntity)),
    routeMedianNs: median(routes),
    routeP95Ns: median(samples.map((sample) => sample.routeP95Ns)),
    minimumAllocationObjectsPerRoute: median(
      samples.map((sample) => sample.minimumAllocationObjectsPerRoute),
    ),
    resultEntriesPerRoute: median(samples.map((sample) => sample.resultEntriesPerRoute)),
    checksum: first.checksum,
    routeMinNs: Math.min(...routes),
    routeMaxNs: Math.max(...routes),
    routeCoefficientOfVariation: coefficientOfVariation(routes),
    constructionMinMs: Math.min(...constructions),
    constructionMaxMs: Math.max(...constructions),
  };
});

await writeResult(
  'routing-replicated.json',
  `${JSON.stringify({ generatedAt: new Date().toISOString(), processCount, rows: aggregated }, null, 2)}\n`,
);
await writeResult('routing-replicated.csv', aggregateCsv(aggregated));
await writeResult('routing-replicated.md', aggregateMarkdown(aggregated));
console.log(aggregateMarkdown(aggregated));

function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return Math.sqrt(variance) / mean;
}

function aggregateCsv(rows: readonly AggregateRow[]): string {
  const header = [
    'topology', 'kernel', 'processes', 'route_median_ns', 'route_min_ns',
    'route_max_ns', 'route_cv', 'construction_median_ms', 'construction_min_ms',
    'construction_max_ms', 'mount_median_ns_per_entity',
    'unmount_median_ns_per_entity', 'retained_units',
  ];
  const values = rows.map((row) => [
    row.topology,
    row.kernel,
    row.processes,
    row.routeMedianNs.toFixed(2),
    row.routeMinNs.toFixed(2),
    row.routeMaxNs.toFixed(2),
    row.routeCoefficientOfVariation.toFixed(4),
    row.constructionMs.toFixed(4),
    row.constructionMinMs.toFixed(4),
    row.constructionMaxMs.toFixed(4),
    row.mountNsPerEntity.toFixed(2),
    row.unmountNsPerEntity.toFixed(2),
    Object.values(row.retainedUnits).reduce((sum, value) => sum + value, 0),
  ]);
  return `${[header, ...values].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function aggregateMarkdown(rows: readonly AggregateRow[]): string {
  const paired = new Map<string, Partial<Record<BenchmarkRow['kernel'], AggregateRow>>>();
  for (const row of rows) {
    const entry = paired.get(row.topology) ?? {};
    entry[row.kernel] = row;
    paired.set(row.topology, entry);
  }
  return [
    '# Replicated isolated routing benchmark',
    '',
    `Each cell is the median of ${processCount} fresh processes; brackets show the process minimum and maximum.`,
    '',
    '| Topology | Static route ns [range] | Dynamic route ns [range] | Static/dynamic | Static mount ns/entity | Dynamic mount ns/entity |',
    '|---|---:|---:|---:|---:|---:|',
    ...[...paired.entries()].map(([topology, pair]) => {
      const stat = pair['static-index']!;
      const dynamic = pair['dynamic-subscription']!;
      return `| ${topology} | ${stat.routeMedianNs.toFixed(1)} [${stat.routeMinNs.toFixed(1)}, ${stat.routeMaxNs.toFixed(1)}] | ${dynamic.routeMedianNs.toFixed(1)} [${dynamic.routeMinNs.toFixed(1)}, ${dynamic.routeMaxNs.toFixed(1)}] | ${(stat.routeMedianNs / dynamic.routeMedianNs).toFixed(2)}x | ${stat.mountNsPerEntity.toFixed(1)} | ${dynamic.mountNsPerEntity.toFixed(1)} |`;
    }),
    '',
    'The kernels are checked for identical selected entity sets before timing. These measurements isolate routing and lifecycle representation costs; they contain no DOM, rendering, or framework scheduler.',
    '',
  ].join('\n');
}
