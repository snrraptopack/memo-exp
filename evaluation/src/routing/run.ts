import { csvCell, median, percentile, writeResult } from '../shared';
import {
  DynamicSubscriptionKernel,
  StaticIndexKernel,
  type RoutingKernel,
} from './kernels';
import { generateTopology, topologyConfigs, type Topology } from './topology';

export interface BenchmarkRow {
  topology: string;
  kernel: 'static-index' | 'dynamic-subscription';
  keys: number;
  entities: number;
  fanout: number;
  wildcardDensity: number;
  writesPerCommit: number;
  derivedDepth: number;
  constructionMs: number;
  mountNsPerEntity: number;
  unmountNsPerEntity: number;
  routeMedianNs: number;
  routeP95Ns: number;
  minimumAllocationObjectsPerRoute: number;
  resultEntriesPerRoute: number;
  retainedUnits: Record<string, number>;
  checksum: number;
}

const rows: BenchmarkRow[] = [];
const outputPrefix = process.env.EVAL_ROUTING_PREFIX ?? 'routing';
for (const config of topologyConfigs) {
  const topology = generateTopology(config);
  validateEquivalentRouting(topology);
  rows.push(measure(topology, 'static-index'));
  rows.push(measure(topology, 'dynamic-subscription'));
}

function validateEquivalentRouting(topology: Topology): void {
  const staticKernel = createKernel(topology, 'static-index');
  const dynamicKernel = createKernel(topology, 'dynamic-subscription');
  mountAll(staticKernel, topology);
  mountAll(dynamicKernel, topology);
  for (const commit of topology.commits.slice(0, 64)) {
    const staticResult = routeCascade(staticKernel, commit, topology.config.derivedDepth).sort();
    const dynamicResult = routeCascade(dynamicKernel, commit, topology.config.derivedDepth).sort();
    if (staticResult.join('\0') !== dynamicResult.join('\0')) {
      throw new Error(`kernel topology mismatch in ${topology.config.name}`);
    }
  }
}

await writeResult(`${outputPrefix}.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);
await writeResult(`${outputPrefix}.csv`, routingCsv(rows));
await writeResult(`${outputPrefix}.md`, routingMarkdown(rows));
await writeResult(`${outputPrefix}.svg`, routingSvg(rows));
if (process.env.EVAL_ROUTING_QUIET !== '1') console.log(routingMarkdown(rows));

function createKernel(
  topology: Topology,
  name: BenchmarkRow['kernel'],
): RoutingKernel {
  return name === 'static-index'
    ? new StaticIndexKernel(topology.table)
    : new DynamicSubscriptionKernel(topology.keys);
}

function mountAll(kernel: RoutingKernel, topology: Topology): void {
  for (const id of topology.ids) kernel.mount(id, topology.entityKeys.get(id) ?? []);
}

function routeCascade(
  kernel: RoutingKernel,
  writes: readonly string[],
  depth: number,
): string[] {
  return routeCascadeMeasured(kernel, writes, depth).result;
}

function routeCascadeMeasured(
  kernel: RoutingKernel,
  writes: readonly string[],
  depth: number,
): { result: string[]; waves: number } {
  const out = new Set<string>();
  const queue = [writes];
  let waves = 0;
  while (queue.length > 0) {
    waves++;
    const selected = kernel.route(queue.shift()!);
    const propagated: string[] = [];
    for (const id of selected) {
      out.add(id);
      const match = /^App\/\$derived:(\d+)$/.exec(id);
      if (match !== null) {
        const level = Number(match[1]);
        if (level < depth) propagated.push(`derived:${level}`);
      }
    }
    if (propagated.length > 0) queue.push(propagated);
  }
  return { result: [...out], waves };
}

function measure(topology: Topology, name: BenchmarkRow['kernel']): BenchmarkRow {
  const constructionSamples: number[] = [];
  for (let sample = 0; sample < 9; sample++) {
    const start = performance.now();
    createKernel(topology, name);
    constructionSamples.push(performance.now() - start);
  }

  const lifecycleIds = topology.ids.slice(0, Math.max(1, Math.floor(topology.ids.length / 10)));
  const mountSamples: number[] = [];
  const unmountSamples: number[] = [];
  for (let sample = 0; sample < 7; sample++) {
    const lifecycleKernel = createKernel(topology, name);
    const mountStart = performance.now();
    mountAll(lifecycleKernel, topology);
    mountSamples.push(((performance.now() - mountStart) * 1e6) / topology.ids.length);
    const unmountStart = performance.now();
    for (const id of lifecycleIds) {
      lifecycleKernel.unmount(id, topology.entityKeys.get(id) ?? []);
    }
    unmountSamples.push(((performance.now() - unmountStart) * 1e6) / lifecycleIds.length);
  }
  const mountNsPerEntity = median(mountSamples);
  const unmountNsPerEntity = median(unmountSamples);

  const kernel = createKernel(topology, name);
  mountAll(kernel, topology);

  for (let index = 0; index < 1024; index++) {
    routeCascade(kernel, topology.commits[index % topology.commits.length]!, topology.config.derivedDepth);
  }
  const routeSamples: number[] = [];
  let checksum = 0;
  for (let sample = 0; sample < 9; sample++) {
    const start = performance.now();
    for (const commit of topology.commits) {
      checksum += routeCascade(kernel, commit, topology.config.derivedDepth).length;
    }
    routeSamples.push(((performance.now() - start) * 1e6) / topology.commits.length);
  }

  let totalWaves = 0;
  let totalEntries = 0;
  for (let index = 0; index < 256; index++) {
    const measurement = routeCascadeMeasured(
      kernel,
      topology.commits[index % topology.commits.length]!,
      topology.config.derivedDepth,
    );
    totalWaves += measurement.waves;
    totalEntries += measurement.result.length;
  }
  return {
    topology: topology.config.name,
    kernel: name,
    keys: topology.config.keys,
    entities: topology.config.entities,
    fanout: topology.config.fanout,
    wildcardDensity: topology.config.wildcardDensity,
    writesPerCommit: topology.config.writesPerCommit,
    derivedDepth: topology.config.derivedDepth,
    constructionMs: median(constructionSamples),
    mountNsPerEntity,
    unmountNsPerEntity,
    routeMedianNs: median(routeSamples),
    routeP95Ns: percentile(routeSamples, 0.95),
    // Lower bound: each wave creates its routing Set/result Array plus a
    // propagation Array; the cascade creates an output Set, queue, and Array.
    minimumAllocationObjectsPerRoute: (3 * totalWaves) / 256 + 3,
    resultEntriesPerRoute: totalEntries / 256,
    retainedUnits: kernel.retainedUnits(),
    checksum,
  };
}

function routingCsv(rows: readonly BenchmarkRow[]): string {
  const header = [
    'topology', 'kernel', 'keys', 'entities', 'fanout', 'wildcard_density',
    'writes_per_commit', 'derived_depth', 'construction_ms', 'mount_ns_per_entity',
    'unmount_ns_per_entity', 'route_median_ns', 'route_p95_ns',
    'minimum_allocation_objects_per_route', 'result_entries_per_route', 'exact_edges', 'wildcard_patterns',
    'materialized_wildcard_edges', 'subscription_edges', 'checksum',
  ];
  const values = rows.map((row) => [
    row.topology, row.kernel, row.keys, row.entities, row.fanout,
    row.wildcardDensity, row.writesPerCommit, row.derivedDepth,
    row.constructionMs.toFixed(4), row.mountNsPerEntity.toFixed(2),
    row.unmountNsPerEntity.toFixed(2), row.routeMedianNs.toFixed(2),
    row.routeP95Ns.toFixed(2), row.minimumAllocationObjectsPerRoute.toFixed(2),
    row.resultEntriesPerRoute.toFixed(2),
    row.retainedUnits.exactEdges ?? 0, row.retainedUnits.wildcardPatterns ?? 0,
    row.retainedUnits.materializedWildcardEdges ?? 0,
    row.retainedUnits.subscriptionEdges ?? 0, row.checksum,
  ]);
  return `${[header, ...values].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function routingMarkdown(rows: readonly BenchmarkRow[]): string {
  return [
    '# Isolated routing-kernel benchmark',
    '',
    '| Topology | Kernel | Construct (ms) | Mount (ns/entity) | Unmount (ns/entity) | Route median (ns) | Alloc. objects/route | Retained units |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map((row) => {
      const retained = Object.values(row.retainedUnits).reduce((sum, value) => sum + value, 0);
      return `| ${row.topology} | ${row.kernel} | ${row.constructionMs.toFixed(3)} | ${row.mountNsPerEntity.toFixed(1)} | ${row.unmountNsPerEntity.toFixed(1)} | ${row.routeMedianNs.toFixed(1)} | ${row.minimumAllocationObjectsPerRoute.toFixed(1)} | ${retained} |`;
    }),
    '',
    'Construction and routing times are medians of nine in-process samples after warm-up; lifecycle times are medians of seven fresh-kernel samples. The dynamic baseline is a purpose-built key-to-subscriber Set, not Solid or Vue. No DOM, rendering, or framework scheduler is included. Allocation objects are a structural lower bound and retained representation units are exact logical counts, avoiding VM-specific heap-sampling noise.',
    '',
  ].join('\n');
}

function routingSvg(rows: readonly BenchmarkRow[]): string {
  const width = 1000;
  const height = 80 + rows.length * 34;
  const max = Math.max(...rows.map((row) => row.routeMedianNs));
  const bars = rows.map((row, index) => {
    const y = 55 + index * 34;
    const barWidth = max === 0 ? 0 : (row.routeMedianNs / max) * 520;
    const color = row.kernel === 'static-index' ? '#2563eb' : '#ea580c';
    return `<text x="10" y="${y + 14}" font-size="12">${escapeXml(row.topology)} / ${row.kernel}</text><rect x="390" y="${y}" width="${barWidth.toFixed(1)}" height="20" fill="${color}"/><text x="${(400 + barWidth).toFixed(1)}" y="${y + 14}" font-size="12">${row.routeMedianNs.toFixed(1)} ns</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="10" y="25" font-size="18" font-family="sans-serif">Median routing time (lower is better)</text><g font-family="sans-serif">${bars}</g></svg>\n`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
