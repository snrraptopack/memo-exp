import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ClassifiedSite,
  CorpusResult,
  CoverageModeResult,
  TierCounts,
} from './contracts';
import { artifactRoot, resultsRoot } from './shared';

interface CoverageData {
  summary: {
    generatedAt: string;
    corpusPrograms: number;
    acceptedPrograms: number;
    acceptedLoc: number;
    acceptedModules: number;
    linkedTotals: TierCounts;
    ablatedTotals: TierCounts;
    linkedUnboundedPercent: number;
    ablatedUnboundedPercent: number;
    note: string;
  };
  programs: CorpusResult[];
}

interface OracleRow {
  case: string;
  category: string;
  scenario: string;
  writes: string[];
  staticSelected: string[];
  oracleObserved: string[];
  changed: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

interface OracleData {
  summary: Record<string, unknown>;
  rows: OracleRow[];
}

interface RoutingRow {
  topology: string;
  kernel: string;
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
  processes?: number;
  routeMinNs?: number;
  routeMaxNs?: number;
  routeCoefficientOfVariation?: number;
  constructionMinMs?: number;
  constructionMaxMs?: number;
}

interface RoutingData {
  generatedAt: string;
  processCount?: number;
  rows: RoutingRow[];
}

const coverage = await json<CoverageData>('coverage.json');
const oracle = await json<OracleData>('oracle.json');
const routing = await json<RoutingData>('routing-replicated.json');
const routingRuns = await Promise.all(
  [1, 2, 3].map((index) => json<RoutingData>(`routing-run-${index}.json`)),
);
const environment = await json<Record<string, unknown>>('environment.json');

const findingsPath = join(artifactRoot, 'FINDINGS.md');
const current = await readFile(findingsPath, 'utf8');
const start = '<!-- GENERATED-EVIDENCE:START -->';
const end = '<!-- GENERATED-EVIDENCE:END -->';
const startIndex = current.indexOf(start);
const endIndex = current.indexOf(end);
if (startIndex < 0 || endIndex < startIndex) {
  throw new Error('FINDINGS.md is missing generated-evidence markers');
}

const generated = [
  generationMetadata(),
  completeCoverage(),
  completeOracle(),
  completeRouting(),
].join('\n\n');
const next = `${current.slice(0, startIndex + start.length)}\n\n${generated}\n\n${current.slice(endIndex)}`;
await writeFile(findingsPath, next);
console.log(`updated FINDINGS.md with ${coverage.programs.length} corpus records, ${oracle.rows.length} oracle scenarios, and ${routingRuns.length} routing processes`);

async function json<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(resultsRoot, name), 'utf8')) as T;
}

function generationMetadata(): string {
  return [
    '### Evidence generation metadata',
    '',
    '| Field | Value |',
    '|---|---|',
    ...Object.entries(environment).map(([key, value]) =>
      `| ${cell(key)} | ${cell(typeof value === 'object' ? JSON.stringify(value) : String(value))} |`,
    ),
    `| Coverage generated | ${cell(coverage.summary.generatedAt)} |`,
    `| Oracle generated | ${cell(String(oracle.summary.generatedAt ?? 'unknown'))} |`,
    `| Replicated routing generated | ${cell(routing.generatedAt)} |`,
    '',
    'The recorded Git state is intentionally disclosed. A camera-ready artifact should rerun this ledger from the final tagged revision so `gitDirty` is false and the commit identifies the archived source.',
  ].join('\n');
}

function completeCoverage(): string {
  return [
    '### Complete coverage and ablation ledger',
    '',
    `The corpus loader found ${coverage.summary.corpusPrograms} programs: ${coverage.summary.acceptedPrograms} accepted programs with ${coverage.summary.acceptedModules} modules and ${coverage.summary.acceptedLoc} LOC, plus ${coverage.summary.corpusPrograms - coverage.summary.acceptedPrograms} expected rejection.`,
    '',
    '| Mode | Exact | Receiver-bounded | Parameter-relative | Unbounded | Rejected | Unbounded rate |',
    '|---|---:|---:|---:|---:|---:|---:|',
    countsRow('Linked', coverage.summary.linkedTotals, coverage.summary.linkedUnboundedPercent),
    countsRow('Function summaries ablated', coverage.summary.ablatedTotals, coverage.summary.ablatedUnboundedPercent),
    '',
    '#### Every corpus program',
    '',
    '| Program | Category | Expected | LOC | Modules | Adaptations | Unsupported constructs | Linked E/B/P/U/R | Ablated E/B/P/U/R | Linked reader keys/edges |',
    '|---|---|---|---:|---:|---|---|---:|---:|---:|',
    ...coverage.programs.map((program) => {
      const descriptor = program.descriptor;
      return `| ${cell(descriptor.name)} | ${cell(descriptor.category)} | ${descriptor.expect} | ${program.loc} | ${program.modules} | ${cell(descriptor.manualAdaptations.join('; ') || 'none')} | ${cell(descriptor.unsupportedConstructs.join('; ') || 'none')} | ${compactCounts(program.linked.counts)} | ${compactCounts(program.ablated.counts)} | ${program.linked.readerKeys}/${program.linked.readerEdges} |`;
    }),
    '',
    'Tier tuple order is exact / receiver-bounded / parameter-relative / unbounded / rejected.',
    '',
    ...coverage.programs.flatMap(programDetails),
  ].join('\n');
}

function programDetails(program: CorpusResult): string[] {
  const linkedSites = new Map(program.linked.sites.map((site) => [siteIdentity(site), site]));
  const ablatedSites = new Map(program.ablated.sites.map((site) => [siteIdentity(site), site]));
  const identities = [...new Set([...linkedSites.keys(), ...ablatedSites.keys()])].sort((left, right) => {
    const a = linkedSites.get(left) ?? ablatedSites.get(left)!;
    const b = linkedSites.get(right) ?? ablatedSites.get(right)!;
    return a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column;
  });
  return [
    `#### Program: ${program.descriptor.name}`,
    '',
    program.descriptor.description,
    '',
    `- Expected result: ${program.descriptor.expect}. Linked accepted: ${program.linked.accepted}. Ablated accepted: ${program.ablated.accepted}.`,
    `- LOC/modules: ${program.loc}/${program.modules}. Reader keys/edges: ${program.linked.readerKeys}/${program.linked.readerEdges}.`,
    ...(program.linked.error === undefined ? [] : [`- Linked diagnostic: ${inline(program.linked.error)}`]),
    ...(program.ablated.error === undefined ? [] : [`- Ablated diagnostic: ${inline(program.ablated.error)}`]),
    '',
    '| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |',
    '|---|---|---|---|---|---|',
    ...identities.map((identity) => {
      const linked = linkedSites.get(identity);
      const ablated = ablatedSites.get(identity);
      const representative = linked ?? ablated!;
      return `| ${cell(`${representative.file}:${representative.line}:${representative.column}`)} | ${representative.kind} | ${code(representative.syntax || '(diagnostic)')} | ${siteResult(linked)} | ${siteResult(ablated)} | ${cell(linked?.detail ?? ablated?.detail ?? '')} |`;
    }),
    '',
    'Static reader table (canonical key to structural entity patterns):',
    '',
    '| Canonical read key | Linked entity patterns | Ablated entity patterns |',
    '|---|---|---|',
    ...[...new Set([
      ...Object.keys(program.linked.readers),
      ...Object.keys(program.ablated.readers),
    ])].sort().map((key) =>
      `| ${cell(key)} | ${setCell(program.linked.readers[key] ?? [])} | ${setCell(program.ablated.readers[key] ?? [])} |`,
    ),
    ...(program.linked.readerKeys === 0 ? ['| none | $\\varnothing$ | $\\varnothing$ |'] : []),
    '',
  ];
}

function completeOracle(): string {
  const summary = oracle.summary;
  return [
    '### Complete concrete-execution oracle ledger',
    '',
    `Cases/scenarios: ${summary.cases}/${summary.scenarios}. TP=${summary.truePositives}, FP=${summary.falsePositives}, FN=${summary.falseNegatives}, precision=${percent(Number(summary.precision))}, recall=${percent(Number(summary.recall))}.`,
    '',
    '| # | Case | Category | Scenario | Actual writes W | Static selection S | Oracle selection O | Changed outputs C | TP/FP/FN | Precision/recall |',
    '|---:|---|---|---|---|---|---|---|---:|---:|',
    ...oracle.rows.map((row, index) =>
      `| ${index + 1} | ${cell(row.case)} | ${cell(row.category)} | ${cell(row.scenario)} | ${setCell(row.writes)} | ${setCell(row.staticSelected)} | ${setCell(row.oracleObserved)} | ${setCell(row.changed)} | ${row.truePositives}/${row.falsePositives}/${row.falseNegatives} | ${percent(row.precision)} / ${percent(row.recall)} |`,
    ),
    '',
    '#### Oracle interpretation by scenario',
    '',
    ...oracle.rows.map((row, index) => {
      const reason = row.falsePositives === 0
        ? 'Static selection exactly covered the concretely observed dependency set.'
        : row.category === 'branching'
          ? 'The static branch union selected a computation whose inactive path was not read on the preceding execution.'
          : 'The current module-object/path analysis conservatively selected an additional sibling computation.';
      return `${index + 1}. **${row.case} — ${row.scenario}:** ${reason} ${row.changed.length === 0 ? 'No derived output changed.' : `${row.changed.length} derived output(s) changed.`}`;
    }),
  ].join('\n');
}

function completeRouting(): string {
  return [
    '### Complete routing benchmark ledger',
    '',
    `Fresh processes: ${routing.processCount ?? routingRuns.length}. Each process contains nine timed routing samples after 1,024 warmups and seven lifecycle samples.`,
    '',
    '#### Generated topology parameters',
    '',
    '| Topology | Keys | Entities | Fan-out | Wildcard density | Writes/commit | Derived depth |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...uniqueTopologies(routing.rows).map((row) =>
      `| ${cell(row.topology)} | ${row.keys} | ${row.entities} | ${row.fanout} | ${percent(row.wildcardDensity)} | ${row.writesPerCommit} | ${row.derivedDepth} |`,
    ),
    '',
    '#### Cross-process aggregate',
    '',
    '| Topology | Kernel | Construct ms [range] | Mount ns/entity | Unmount ns/entity | Route median ns [range] | Route P95 ns | Route CV | Minimum allocation objects/route | Result entries/route | Retained exact/pattern/materialized/subscription | Checksum |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|',
    ...routing.rows.map((row) => routingRow(row, true)),
    '',
    'CV is the sample standard deviation divided by the mean of the three process medians. Retained values are logical representation-unit counts, not VM heap bytes. Allocation objects are a structural lower bound.',
    '',
    ...routingRuns.flatMap((run, index) => [
      `#### Fresh routing process ${index + 1}`,
      '',
      `Generated: ${run.generatedAt}.`,
      '',
      '| Topology | Kernel | Construct ms | Mount ns/entity | Unmount ns/entity | Route median ns | Route P95 ns | Minimum allocation objects/route | Result entries/route | Retained exact/pattern/materialized/subscription | Checksum |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|',
      ...run.rows.map((row) => routingRow(row, false)),
      '',
    ]),
    '#### Direct static/dynamic comparison from cross-process medians',
    '',
    '| Topology | Static route ns | Dynamic route ns | Static/dynamic | Static mount ns/entity | Dynamic mount ns/entity | Static/dynamic mount |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...pairedRoutingRows(routing.rows),
  ].join('\n');
}

function routingRow(row: RoutingRow, aggregate: boolean): string {
  const retained = [
    row.retainedUnits.exactEdges ?? 0,
    row.retainedUnits.wildcardPatterns ?? 0,
    row.retainedUnits.materializedWildcardEdges ?? 0,
    row.retainedUnits.subscriptionEdges ?? 0,
  ].join('/');
  const construction = aggregate
    ? `${fixed(row.constructionMs, 4)} [${fixed(row.constructionMinMs ?? row.constructionMs, 4)}, ${fixed(row.constructionMaxMs ?? row.constructionMs, 4)}]`
    : fixed(row.constructionMs, 4);
  const route = aggregate
    ? `${fixed(row.routeMedianNs, 1)} [${fixed(row.routeMinNs ?? row.routeMedianNs, 1)}, ${fixed(row.routeMaxNs ?? row.routeMedianNs, 1)}]`
    : fixed(row.routeMedianNs, 1);
  const cv = aggregate ? ` | ${fixed(row.routeCoefficientOfVariation ?? 0, 4)}` : '';
  return `| ${cell(row.topology)} | ${cell(row.kernel)} | ${construction} | ${fixed(row.mountNsPerEntity, 1)} | ${fixed(row.unmountNsPerEntity, 1)} | ${route} | ${fixed(row.routeP95Ns, 1)}${cv} | ${fixed(row.minimumAllocationObjectsPerRoute, 1)} | ${fixed(row.resultEntriesPerRoute, 1)} | ${retained} | ${row.checksum} |`;
}

function pairedRoutingRows(rows: readonly RoutingRow[]): string[] {
  const groups = new Map<string, RoutingRow[]>();
  for (const row of rows) {
    const group = groups.get(row.topology) ?? [];
    group.push(row);
    groups.set(row.topology, group);
  }
  return [...groups.entries()].map(([topology, group]) => {
    const stat = group.find((row) => row.kernel === 'static-index')!;
    const dynamic = group.find((row) => row.kernel === 'dynamic-subscription')!;
    return `| ${cell(topology)} | ${fixed(stat.routeMedianNs, 1)} | ${fixed(dynamic.routeMedianNs, 1)} | ${fixed(stat.routeMedianNs / dynamic.routeMedianNs, 2)}x | ${fixed(stat.mountNsPerEntity, 1)} | ${fixed(dynamic.mountNsPerEntity, 1)} | ${fixed(stat.mountNsPerEntity / dynamic.mountNsPerEntity, 2)}x |`;
  });
}

function uniqueTopologies(rows: readonly RoutingRow[]): RoutingRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.topology)) return false;
    seen.add(row.topology);
    return true;
  });
}

function countsRow(label: string, counts: TierCounts, unboundedRate: number): string {
  return `| ${label} | ${counts.exact} | ${counts['receiver-bounded']} | ${counts['parameter-relative']} | ${counts.unbounded} | ${counts.rejected} | ${fixed(unboundedRate, 2)}% |`;
}

function compactCounts(counts: TierCounts): string {
  return [counts.exact, counts['receiver-bounded'], counts['parameter-relative'], counts.unbounded, counts.rejected].join('/');
}

function siteIdentity(site: ClassifiedSite): string {
  return [site.file, site.line, site.column, site.kind, site.syntax].join('\0');
}

function siteResult(site: ClassifiedSite | undefined): string {
  if (site === undefined) return 'not reported';
  const keys = site.canonicalKeys.length === 0 ? 'no finite key' : site.canonicalKeys.join('<br>');
  return `${site.tier}<br>${cell(keys)}`;
}

function setCell(values: readonly string[]): string {
  return values.length === 0 ? '$\\varnothing$' : values.map(cell).join('<br>');
}

function code(value: string): string {
  return `<code>${cell(value).replaceAll('`', '&#96;')}</code>`;
}

function inline(value: string): string {
  return code(value.replaceAll('\r', '').replaceAll('\n', ' '));
}

function cell(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('\r', '')
    .replaceAll('\n', '<br>');
}

function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

function percent(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}
