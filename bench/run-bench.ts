/**
 * @file run-bench.ts
 * M4 — Benchmark runner: memo-dom vs hand-optimized vanilla JS.
 *
 * Methodology:
 *   - each scenario: untimed setup, then a timed op, median of RUNS samples
 *   - synchronous scheduler: time = full invalidation + render + DOM settle
 *   - happy-dom caveat: no layout/paint, so these are RELATIVE algorithmic
 *     numbers, not real-browser frame times. Real-browser runs reuse the same
 *     two apps via a plain HTML page (later).
 */
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
(globalThis as Record<string, unknown>).document = window.document;
(globalThis as Record<string, unknown>).Node = window.Node;

const { setScheduler, unregister, _internals } = await import('../src/kernel');
const { createBenchApp } = await import('./ours');
const { createVanillaApp } = await import('./vanilla');

setScheduler((fn) => fn()); // synchronous commit: measure all work in the op

const RUNS = 7;

interface Scenario {
  name: string;
  setupOurs: (app: BenchAppT) => void;
  opOurs: (app: BenchAppT) => void;
  setupVanilla: (app: VanillaAppT) => void;
  opVanilla: (app: VanillaAppT) => void;
}
type BenchAppT = ReturnType<typeof createBenchApp>;
type VanillaAppT = ReturnType<typeof createVanillaApp>;

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

const scenarios: Scenario[] = [
  {
    name: 'create 1k rows',
    setupOurs: () => {},
    opOurs: (a) => a.click('create1k'),
    setupVanilla: () => {},
    opVanilla: (a) => a.op('create1k'),
  },
  {
    name: 'replace 1k rows',
    setupOurs: (a) => a.click('create1k'),
    opOurs: (a) => a.click('create1k'),
    setupVanilla: (a) => a.op('create1k'),
    opVanilla: (a) => a.op('create1k'),
  },
  {
    name: 'partial update (every 10th)',
    setupOurs: (a) => a.click('create1k'),
    opOurs: (a) => a.click('update'),
    setupVanilla: (a) => a.op('create1k'),
    opVanilla: (a) => a.op('update'),
  },
  {
    name: 'select row',
    setupOurs: (a) => a.click('create1k'),
    opOurs: (a) => a.selectRow(500),
    setupVanilla: (a) => a.op('create1k'),
    opVanilla: (a) => a.selectRow(500),
  },
  {
    name: 'swap rows',
    setupOurs: (a) => a.click('create1k'),
    opOurs: (a) => a.click('swap'),
    setupVanilla: (a) => a.op('create1k'),
    opVanilla: (a) => a.op('swap'),
  },
  {
    name: 'remove row',
    setupOurs: (a) => a.click('create1k'),
    opOurs: (a) => a.click('remove'),
    setupVanilla: (a) => a.op('create1k'),
    opVanilla: (a) => a.op('remove'),
  },
  {
    name: 'create 10k rows',
    setupOurs: (a) => a.click('clear'),
    opOurs: (a) => a.click('create10k'),
    setupVanilla: (a) => a.op('clear'),
    opVanilla: (a) => a.op('create10k'),
  },
  {
    name: 'append 1k to 10k',
    setupOurs: (a) => a.click('create10k'),
    opOurs: (a) => a.click('append1k'),
    setupVanilla: (a) => a.op('create10k'),
    opVanilla: (a) => a.op('append1k'),
  },
  {
    name: 'clear 10k rows',
    setupOurs: (a) => a.click('create10k'),
    opOurs: (a) => a.click('clear'),
    setupVanilla: (a) => a.op('create10k'),
    opVanilla: (a) => a.op('clear'),
  },
];

// ---- run ---------------------------------------------------------------------
const ours = createBenchApp();
document.body.appendChild(ours.root);
const vanilla = createVanillaApp();
document.body.appendChild(vanilla.root);

// JIT warmup — unreported, so cold-start doesn't distort the first scenario
for (let i = 0; i < 3; i++) {
  ours.click('create1k');
  ours.click('update');
  ours.selectRow(10);
  ours.click('clear');
  vanilla.op('create1k');
  vanilla.op('update');
  vanilla.op('clear');
}

console.log(`\nmemo-dom vs vanilla — median of ${RUNS} runs (happy-dom, relative)\n`);
console.log(
  'scenario'.padEnd(28),
  'memo-dom'.padStart(10),
  'vanilla'.padStart(10),
  'ratio'.padStart(8),
);
console.log('-'.repeat(58));

for (const s of scenarios) {
  const tOurs = timeOp(
    () => s.setupOurs(ours),
    () => s.opOurs(ours),
  );
  const tVanilla = timeOp(
    () => s.setupVanilla(vanilla),
    () => s.opVanilla(vanilla),
  );
  const ratio = tOurs / tVanilla;
  console.log(
    s.name.padEnd(28),
    `${tOurs.toFixed(2)}ms`.padStart(10),
    `${tVanilla.toFixed(2)}ms`.padStart(10),
    `${ratio.toFixed(2)}x`.padStart(8),
  );

  // sanity: both apps must agree on row count after structural ops
  if (s.name.includes('create') || s.name.includes('append') || s.name.includes('clear')) {
    if (ours.rowCount() !== vanilla.rowCount()) {
      throw new Error(`row count mismatch after ${s.name}`);
    }
  }
}

console.log('\nregistry size after bench:', [..._internals().registry.keys()].length);
_internals().registry.forEach((_, id) => unregister(id));
