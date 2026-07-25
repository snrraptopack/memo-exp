/**
 * @file browser-entry.ts
 * Real-browser benchmark entry. Bundled by esbuild into browser-bundle.js
 * and driven headlessly by run.ts.
 *
 * Compares 3 implementations:
 *   1. compiledTsx    (compiled TSX component <Row />)
 *   2. compiledInline (compiled TSX inline <li />)
 *   3. vanilla        (native JS baseline)
 */
import { setScheduler } from '../../src/kernel';
import { createVanillaApp } from './vanilla';
import { createCompiledTsxApp } from './compiled-tsx-app';
import { createCompiledInlineApp } from './compiled-inline-app';

setScheduler((fn) => fn()); // sync commit: measure all invalidation+render work

const RUNS = 7;

const compiledTsx = createCompiledTsxApp();
const compiledInline = createCompiledInlineApp();
const vanilla = createVanillaApp();

const divTsx = document.createElement('div');
const divInline = document.createElement('div');
const divVanilla = document.createElement('div');
document.body.append(divTsx, divInline, divVanilla);
divTsx.appendChild(compiledTsx.root);
divInline.appendChild(compiledInline.root);
divVanilla.appendChild(vanilla.root);

type AppT = {
  click?(name: string): void;
  op?(name: string): void;
  selectRow(index: number): void;
  rowCount(): number;
};

interface Scenario {
  name: string;
  setup: (app: AppT) => void;
  op: (app: AppT) => void;
}

const scenarios: Scenario[] = [
  { name: 'create 1k rows', setup: () => {}, op: (a) => (a.click ? a.click('create1k') : a.op!('create1k')) },
  { name: 'replace 1k rows', setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')), op: (a) => (a.click ? a.click('create1k') : a.op!('create1k')) },
  { name: 'partial update (every 10th)', setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')), op: (a) => (a.click ? a.click('update') : a.op!('update')) },
  { name: 'select row', setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')), op: (a) => a.selectRow(500) },
  { name: 'swap rows', setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')), op: (a) => (a.click ? a.click('swap') : a.op!('swap')) },
  { name: 'remove row', setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')), op: (a) => (a.click ? a.click('remove') : a.op!('remove')) },
  { name: 'create 10k rows', setup: (a) => (a.click ? a.click('clear') : a.op!('clear')), op: (a) => (a.click ? a.click('create10k') : a.op!('create10k')) },
  { name: 'append 1k to 10k', setup: (a) => (a.click ? a.click('create10k') : a.op!('create10k')), op: (a) => (a.click ? a.click('append1k') : a.op!('append1k')) },
  { name: 'clear 10k rows', setup: (a) => (a.click ? a.click('create10k') : a.op!('create10k')), op: (a) => (a.click ? a.click('clear') : a.op!('clear')) },
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
  tsx: number;
  inline: number;
  vanilla: number;
  ratioTsx: number;
  ratioInline: number;
}

function runAll(): BenchRow[] {
  // JIT warmup — unreported
  for (let i = 0; i < 3; i++) {
    compiledTsx.click('create1k');
    compiledTsx.click('update');
    compiledTsx.selectRow(10);
    compiledTsx.click('clear');

    compiledInline.click('create1k');
    compiledInline.click('update');
    compiledInline.selectRow(10);
    compiledInline.click('clear');

    vanilla.op('create1k');
    vanilla.op('update');
    vanilla.op('clear');
  }

  const rows: BenchRow[] = [];
  for (const s of scenarios) {
    const tTsx = timeOp(() => s.setup(compiledTsx), () => s.op(compiledTsx));
    const tInline = timeOp(() => s.setup(compiledInline), () => s.op(compiledInline));
    const tVanilla = timeOp(() => s.setup(vanilla), () => s.op(vanilla));
    rows.push({
      name: s.name,
      tsx: tTsx,
      inline: tInline,
      vanilla: tVanilla,
      ratioTsx: tTsx / tVanilla,
      ratioInline: tInline / tVanilla,
    });
  }
  return rows;
}

(window as unknown as Record<string, unknown>).__runAll = runAll;
