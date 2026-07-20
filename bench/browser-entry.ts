/**
 * @file browser-entry.ts
 * M4.5 — Real-browser benchmark entry. Bundled by esbuild into browser-bundle.js
 * and driven headlessly by run-browser.ts (or opened directly for manual runs).
 *
 * Measures synchronous op time in-page (both implementations), median of RUNS.
 * Layout/paint is not measured — same caveat on both sides, fair comparison.
 */
import { setScheduler } from '../src/kernel';
import { createBenchApp } from './ours';
import { createVanillaApp } from './vanilla';

setScheduler((fn) => fn()); // sync commit: measure all invalidation+render work

const RUNS = 7;

const ours = createBenchApp();
const vanilla = createVanillaApp();
const oursDiv = document.createElement('div');
const vanillaDiv = document.createElement('div');
document.body.append(oursDiv, vanillaDiv);
oursDiv.appendChild(ours.root);
vanillaDiv.appendChild(vanilla.root);

interface Scenario {
  name: string;
  setupOurs: () => void;
  opOurs: () => void;
  setupVanilla: () => void;
  opVanilla: () => void;
}

const scenarios: Scenario[] = [
  { name: 'create 1k rows', setupOurs: () => {}, opOurs: () => ours.click('create1k'), setupVanilla: () => {}, opVanilla: () => vanilla.op('create1k') },
  { name: 'replace 1k rows', setupOurs: () => ours.click('create1k'), opOurs: () => ours.click('create1k'), setupVanilla: () => vanilla.op('create1k'), opVanilla: () => vanilla.op('create1k') },
  { name: 'partial update (every 10th)', setupOurs: () => ours.click('create1k'), opOurs: () => ours.click('update'), setupVanilla: () => vanilla.op('create1k'), opVanilla: () => vanilla.op('update') },
  { name: 'select row', setupOurs: () => ours.click('create1k'), opOurs: () => ours.selectRow(500), setupVanilla: () => vanilla.op('create1k'), opVanilla: () => vanilla.selectRow(500) },
  { name: 'swap rows', setupOurs: () => ours.click('create1k'), opOurs: () => ours.click('swap'), setupVanilla: () => vanilla.op('create1k'), opVanilla: () => vanilla.op('swap') },
  { name: 'remove row', setupOurs: () => ours.click('create1k'), opOurs: () => ours.click('remove'), setupVanilla: () => vanilla.op('create1k'), opVanilla: () => vanilla.op('remove') },
  { name: 'create 10k rows', setupOurs: () => ours.click('clear'), opOurs: () => ours.click('create10k'), setupVanilla: () => vanilla.op('clear'), opVanilla: () => vanilla.op('create10k') },
  { name: 'append 1k to 10k', setupOurs: () => ours.click('create10k'), opOurs: () => ours.click('append1k'), setupVanilla: () => vanilla.op('create10k'), opVanilla: () => vanilla.op('append1k') },
  { name: 'clear 10k rows', setupOurs: () => ours.click('create10k'), opOurs: () => ours.click('clear'), setupVanilla: () => vanilla.op('create10k'), opVanilla: () => vanilla.op('clear') },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function timeOp(setup: () => void, op: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    setup();
    const t0 = performance.now();
    op();
    times.push(performance.now() - t0);
  }
  return median(times);
}

export interface BenchRow {
  name: string;
  ours: number;
  vanilla: number;
  ratio: number;
}

function runAll(): BenchRow[] {
  // JIT warmup — unreported
  for (let i = 0; i < 3; i++) {
    ours.click('create1k');
    ours.click('update');
    ours.selectRow(10);
    ours.click('clear');
    vanilla.op('create1k');
    vanilla.op('update');
    vanilla.op('clear');
  }

  const rows: BenchRow[] = [];
  for (const s of scenarios) {
    const tOurs = timeOp(s.setupOurs, s.opOurs);
    const tVanilla = timeOp(s.setupVanilla, s.opVanilla);
    rows.push({ name: s.name, ours: tOurs, vanilla: tVanilla, ratio: tOurs / tVanilla });
  }
  return rows;
}

(window as unknown as Record<string, unknown>).__runAll = runAll;
