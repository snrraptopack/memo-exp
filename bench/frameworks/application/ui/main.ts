import type { ApplicationScenario } from '../contract';
import type { ApplicationRun } from '../results';
import { frameworks, scenarios } from './catalog';
import {
  PreviewHost,
  type LiveMeasurement,
} from './measurement';
import {
  buildLiveApplicationRun,
  downloadApplicationRun,
  type ExportableLiveResult,
} from './export';

type Metric = 'heap' | 'mutations' | 'time';
type ResultSource = 'live' | 'recorded';

interface ComparisonResult extends ExportableLiveResult {
  count: number;
  framework: string;
  gzipBytes: number | null;
  heapDeltaBytes: number | null;
  mutationRecords: number;
  p25Ms: number;
  p75Ms: number;
  scenario: ApplicationScenario;
  source: ResultSource;
  timeMs: number;
  version: string;
}

const frame = required<HTMLIFrameElement>('preview-frame');
const host = new PreviewHost(frame);
const runButton = required<HTMLButtonElement>('run-all');
const countSelect = required<HTMLSelectElement>('run-count');
const samplesSelect = required<HTMLSelectElement>('run-samples');
const progressBar = required<HTMLElement>('progress-bar');
const progressText = required<HTMLElement>('progress-text');
const currentRun = required<HTMLElement>('current-run');
const status = required<HTMLElement>('status');
const sourceFilter = required<HTMLSelectElement>('filter-source');
const countFilter = required<HTMLSelectElement>('filter-count');
const frameworkFilter = required<HTMLSelectElement>('filter-framework');
const scenarioFilter = required<HTMLSelectElement>('filter-scenario');
const metricFilter = required<HTMLSelectElement>('filter-metric');
const resultHead = required<HTMLTableSectionElement>('result-head');
const resultBody = required<HTMLTableSectionElement>('result-body');
const resultEmpty = required<HTMLElement>('result-empty');
const resultTitle = required<HTMLElement>('result-title');
const resultDescription = required<HTMLElement>('result-description');
const exportButton = required<HTMLButtonElement>('export-live');
const summaryBest = required<HTMLElement>('summary-best');
const summarySource = required<HTMLElement>('summary-source');
const summaryScope = required<HTMLElement>('summary-scope');
const recordedMeta = required<HTMLElement>('recorded-meta');

let recordedRun: ApplicationRun | null = null;
let recordedResults: ComparisonResult[] = [];
let liveResults: ComparisonResult[] = [];
let liveSamples = 0;
let running = false;

for (const framework of frameworks) {
  frameworkFilter.add(new Option(framework.label, framework.id));
}
for (const scenario of scenarios) {
  scenarioFilter.add(new Option(scenario.label, scenario.id));
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab!));
}
for (const filter of [
  sourceFilter,
  countFilter,
  frameworkFilter,
  scenarioFilter,
  metricFilter,
]) {
  filter.addEventListener('change', renderResults);
}

runButton.addEventListener('click', () => void runCompleteBenchmark());
exportButton.addEventListener('click', exportLiveResults);
void initialize();

async function initialize(): Promise<void> {
  populateCountFilter([100, 1000]);
  try {
    const response = await fetch('./latest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    recordedRun = (await response.json()) as ApplicationRun;
    recordedResults = flattenRecorded(recordedRun);
    recordedMeta.textContent =
      `${recordedRun.browser} · ` +
      `${new Date(recordedRun.date).toLocaleString()}`;
    renderResults();
  } catch {
    recordedMeta.textContent = 'Recorded results could not be loaded';
  }

  try {
    const count = Number(countSelect.value);
    await host.preview('memoized-dom', 'load', count);
    currentRun.textContent =
      `memoized-dom · Load tickets · ${count.toLocaleString()} tickets`;
    setStatus('Ready to run the complete benchmark', 'success');
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  }
}

async function runCompleteBenchmark(): Promise<void> {
  if (running) return;
  running = true;
  runButton.disabled = true;
  exportButton.disabled = true;
  liveResults = [];

  const count = Number(countSelect.value);
  const samples = Number(samplesSelect.value);
  liveSamples = samples;
  const total = frameworks.length * scenarios.length;
  let completed = 0;
  setProgress(0, total);
  setStatus('Running all frameworks and scenarios…', 'running');

  try {
    for (const framework of frameworks) {
      for (const scenario of scenarios) {
        currentRun.textContent =
          `${framework.label} · ${scenario.label} · ` +
          `${count.toLocaleString()} tickets`;
        const measurement = await host.measure(
          framework.id,
          scenario.id,
          count,
          samples,
        );
        liveResults.push(fromLive(measurement));
        completed++;
        setProgress(completed, total);
      }
    }

    sourceFilter.value = 'live';
    populateCountFilter([
      ...new Set([
        ...recordedResults.map((result) => result.count),
        count,
      ]),
    ]);
    countFilter.value = String(count);
    setStatus(
      `Complete · ${liveResults.length} validated measurements`,
      'success',
    );
    exportButton.disabled = false;
    renderResults();
    activateTab('results');
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  } finally {
    running = false;
    runButton.disabled = false;
  }
}

function renderResults(): void {
  const source = sourceFilter.value as ResultSource;
  const metric = metricFilter.value as Metric;
  const selectedScenario = scenarioFilter.value;
  const selectedFramework = frameworkFilter.value;
  const count = Number(countFilter.value);
  const available = source === 'live' ? liveResults : recordedResults;
  const results = available.filter(
    (result) =>
      result.count === count &&
      (selectedFramework === 'all' ||
        result.framework === selectedFramework),
  );

  summarySource.textContent =
    source === 'live' ? 'This browser session' : 'Recorded isolated run';
  summaryScope.textContent =
    `${results.length.toLocaleString()} measurements · ` +
    `${count.toLocaleString()} tickets`;
  resultTitle.textContent =
    `${metricLabel(metric)} comparison`;

  if (results.length === 0) {
    resultHead.replaceChildren();
    resultBody.replaceChildren();
    resultEmpty.hidden = false;
    resultDescription.textContent =
      source === 'live'
        ? 'Run the complete benchmark to create live results.'
        : 'No recorded measurements match these filters.';
    summaryBest.textContent = '—';
    return;
  }

  resultEmpty.hidden = true;
  if (selectedScenario === 'all') {
    renderMatrix(results, metric);
  } else {
    renderRanking(
      results.filter((result) => result.scenario === selectedScenario),
      metric,
      selectedScenario as ApplicationScenario,
    );
  }
}

function renderMatrix(
  results: readonly ComparisonResult[],
  metric: Metric,
): void {
  resultDescription.textContent =
    'Lower is better. Best value in each workflow is highlighted.';
  resultHead.replaceChildren(
    tableRow([
      headerCell('Framework'),
      ...scenarios.map((scenario) => headerCell(scenario.label)),
    ]),
  );

  const bestByScenario = new Map<ApplicationScenario, number>();
  for (const scenario of scenarios) {
    const values = results
      .filter((result) => result.scenario === scenario.id)
      .map((result) => metricValue(result, metric))
      .filter((value): value is number => value !== null);
    if (values.length > 0) bestByScenario.set(scenario.id, Math.min(...values));
  }

  const rows = frameworks.flatMap((framework) => {
    const own = results.filter((result) => result.framework === framework.id);
    if (own.length === 0) return [];
    return [
      tableRow([
        bodyCell(framework.label, 'framework-cell'),
        ...scenarios.map((scenario) => {
          const result = own.find((entry) => entry.scenario === scenario.id);
          const value = result === undefined ? null : metricValue(result, metric);
          const winner =
            value !== null && value === bestByScenario.get(scenario.id);
          return bodyCell(
            value === null ? '—' : formatMetric(value, metric),
            winner ? 'winner number-cell' : 'number-cell',
          );
        }),
      ]),
    ];
  });
  resultBody.replaceChildren(...rows);

  const allValues = results
    .map((result) => ({
      framework: result.framework,
      value: metricValue(result, metric),
    }))
    .filter(
      (entry): entry is { framework: string; value: number } =>
        entry.value !== null,
    );
  const best = allValues.reduce(
    (current, entry) =>
      current === null || entry.value < current.value ? entry : current,
    null as { framework: string; value: number } | null,
  );
  summaryBest.textContent =
    best === null
      ? 'Unavailable'
      : `${frameworkLabel(best.framework)} · ` +
        `${formatMetric(best.value, metric)}`;
}

function renderRanking(
  results: readonly ComparisonResult[],
  metric: Metric,
  scenario: ApplicationScenario,
): void {
  resultDescription.textContent =
    `${scenarioLabel(scenario)} · lower is better`;
  const ranked = results
    .map((result) => ({ result, value: metricValue(result, metric) }))
    .filter(
      (entry): entry is { result: ComparisonResult; value: number } =>
        entry.value !== null,
    )
    .sort((left, right) => left.value - right.value);
  const best = ranked[0]?.value;

  resultHead.replaceChildren(
    tableRow([
      headerCell('Rank'),
      headerCell('Framework'),
      headerCell(metricLabel(metric)),
      headerCell('Compared with best'),
      headerCell('Complete gzip'),
    ]),
  );
  resultBody.replaceChildren(
    ...ranked.map(({ result, value }, index) =>
      tableRow([
        bodyCell(String(index + 1), 'rank-cell'),
        bodyCell(frameworkLabel(result.framework), 'framework-cell'),
        bodyCell(
          formatMetric(value, metric),
          index === 0 ? 'winner number-cell' : 'number-cell',
        ),
        bodyCell(
          best === undefined || best === 0
            ? '—'
            : index === 0
              ? 'Best'
              : `+${(((value / best) - 1) * 100).toFixed(1)}%`,
          'number-cell',
        ),
        bodyCell(formatBytes(result.gzipBytes), 'number-cell'),
      ]),
    ),
  );
  summaryBest.textContent =
    ranked.length === 0
      ? 'Unavailable'
      : `${frameworkLabel(ranked[0]!.result.framework)} · ` +
        `${formatMetric(ranked[0]!.value, metric)}`;
}

function flattenRecorded(run: ApplicationRun): ComparisonResult[] {
  return run.results.flatMap((framework) =>
    framework.measurements.map((measurement) => ({
      count: measurement.count,
      framework: framework.id,
      gzipBytes: framework.bundle.gzipBytes,
      heapDeltaBytes: measurement.heapDeltaBytes,
      mutationRecords: measurement.mutationRecords,
      p25Ms: measurement.p25NsPerOperation / 1_000_000,
      p75Ms: measurement.p75NsPerOperation / 1_000_000,
      scenario: measurement.scenario,
      source: 'recorded',
      timeMs: measurement.nsPerOperation / 1_000_000,
      version: framework.version,
    })),
  );
}

function fromLive(measurement: LiveMeasurement): ComparisonResult {
  const recordedFramework = recordedRun?.results.find(
    (result) => result.id === measurement.framework,
  );
  return {
    count: measurement.count,
    framework: measurement.framework,
    gzipBytes: recordedFramework?.bundle.gzipBytes ?? null,
    heapDeltaBytes: measurement.heapDeltaBytes,
    mutationRecords: measurement.mutationRecords,
    p25Ms: measurement.p25Ms,
    p75Ms: measurement.p75Ms,
    scenario: measurement.scenario,
    source: 'live',
    timeMs: measurement.timeMs,
    version: recordedFramework?.version ?? 'live',
  };
}

function exportLiveResults(): void {
  if (liveResults.length === 0) return;

  const run = buildLiveApplicationRun(
    liveResults,
    liveSamples,
    recordedRun,
    {
      browser: navigator.userAgent,
      platform: navigator.platform,
    },
  );
  downloadApplicationRun(run);
}

function activateTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLElement>('[data-tab]')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== name;
  }
}

function setProgress(completed: number, total: number): void {
  const ratio = total === 0 ? 0 : completed / total;
  progressBar.style.width = `${ratio * 100}%`;
  progressText.textContent =
    `${completed.toLocaleString()} of ${total.toLocaleString()} workflows`;
}

function populateCountFilter(counts: readonly number[]): void {
  const selected = countFilter.value || '1000';
  countFilter.replaceChildren(
    ...[...counts]
      .sort((left, right) => left - right)
      .map(
        (count) =>
          new Option(`${count.toLocaleString()} tickets`, String(count)),
      ),
  );
  if ([...countFilter.options].some((option) => option.value === selected)) {
    countFilter.value = selected;
  }
}

function metricValue(
  result: ComparisonResult,
  metric: Metric,
): number | null {
  if (metric === 'time') return result.timeMs;
  if (metric === 'heap') return result.heapDeltaBytes;
  return result.mutationRecords;
}

function formatMetric(value: number, metric: Metric): string {
  if (metric === 'time') {
    return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
  }
  if (metric === 'heap') return formatBytes(value);
  return value.toLocaleString();
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Unavailable';
  const absolute = Math.abs(value);
  if (absolute < 1024) return `${value.toLocaleString()} B`;
  if (absolute < 1024 * 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function metricLabel(metric: Metric): string {
  if (metric === 'time') return 'Median time';
  if (metric === 'heap') return 'Heap delta';
  return 'DOM mutation records';
}

function frameworkLabel(id: string): string {
  return frameworks.find((framework) => framework.id === id)?.label ?? id;
}

function scenarioLabel(id: ApplicationScenario): string {
  return scenarios.find((scenario) => scenario.id === id)?.label ?? id;
}

function setStatus(
  message: string,
  tone: 'error' | 'running' | 'success',
): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tableRow(cells: readonly HTMLTableCellElement[]): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.append(...cells);
  return row;
}

function headerCell(text: string): HTMLTableCellElement {
  const cell = document.createElement('th');
  cell.textContent = text;
  return cell;
}

function bodyCell(text: string, className?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className !== undefined) cell.className = className;
  return cell;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing dashboard element #${id}`);
  return element as T;
}
