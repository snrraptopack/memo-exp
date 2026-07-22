/**
 * @file run-bench.ts
 * Benchmark runner comparing:
 *   1. memo-dom (compiled TSX — actual Babel compiler output)
 *   2. memo-dom (hand-compiled M4 legacy mock)
 *   3. vanilla JS baseline
 */
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
(globalThis as Record<string, unknown>).document = window.document;
(globalThis as Record<string, unknown>).Node = window.Node;

const { setScheduler, unregister, _internals } = await import('../src/kernel');
const { createBenchApp } = await import('./ours');
const { createVanillaApp } = await import('./vanilla');
const { createCompiledTsxApp } = await import('./compiled-app');

setScheduler((fn) => fn()); // synchronous commit: measure all work in the op

const RUNS = 7;

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
    setup: () => {},
    op: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
  },
  {
    name: 'replace 1k rows',
    setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
    op: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
  },
  {
    name: 'partial update (every 10th)',
    setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
    op: (a) => (a.click ? a.click('update') : a.op!('update')),
  },
  {
    name: 'select row',
    setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
    op: (a) => a.selectRow(500),
  },
  {
    name: 'swap rows',
    setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
    op: (a) => (a.click ? a.click('swap') : a.op!('swap')),
  },
  {
    name: 'remove row',
    setup: (a) => (a.click ? a.click('create1k') : a.op!('create1k')),
    op: (a) => (a.click ? a.click('remove') : a.op!('remove')),
  },
  {
    name: 'create 10k rows',
    setup: (a) => (a.click ? a.click('clear') : a.op!('clear')),
    op: (a) => (a.click ? a.click('create10k') : a.op!('create10k')),
  },
  {
    name: 'append 1k to 10k',
    setup: (a) => (a.click ? a.click('create10k') : a.op!('create10k')),
    op: (a) => (a.click ? a.click('append1k') : a.op!('append1k')),
  },
  {
    name: 'clear 10k rows',
    setup: (a) => (a.click ? a.click('create10k') : a.op!('create10k')),
    op: (a) => (a.click ? a.click('clear') : a.op!('clear')),
  },
];

// ---- run ---------------------------------------------------------------------
const compiledTsx = await createCompiledTsxApp();
document.body.appendChild(compiledTsx.root);

const ours = createBenchApp();
document.body.appendChild(ours.root);

const vanilla = createVanillaApp();
document.body.appendChild(vanilla.root);

// Warmup
for (let i = 0; i < 3; i++) {
  compiledTsx.click('create1k');
  compiledTsx.click('update');
  compiledTsx.selectRow(10);
  compiledTsx.click('clear');

  ours.click('create1k');
  ours.click('update');
  ours.selectRow(10);
  ours.click('clear');

  vanilla.op('create1k');
  vanilla.op('update');
  vanilla.op('clear');
}

console.log(`\nbenchmark 3-way comparison — median of ${RUNS} runs (happy-dom, relative)\n`);
console.log(
  'scenario'.padEnd(28),
  'compiled-tsx'.padStart(14),
  'legacy-ours'.padStart(14),
  'vanilla'.padStart(12),
  'ratio (tsx/vanilla)'.padStart(20),
);
console.log('-'.repeat(90));

for (const s of scenarios) {
  const tTsx = timeOp(
    () => s.setup(compiledTsx),
    () => s.op(compiledTsx),
  );
  const tOurs = timeOp(
    () => s.setup(ours),
    () => s.op(ours),
  );
  const tVanilla = timeOp(
    () => s.setup(vanilla),
    () => s.op(vanilla),
  );
  const ratio = tTsx / tVanilla;

  console.log(
    s.name.padEnd(28),
    `${tTsx.toFixed(2)}ms`.padStart(14),
    `${tOurs.toFixed(2)}ms`.padStart(14),
    `${tVanilla.toFixed(2)}ms`.padStart(12),
    `${ratio.toFixed(2)}x`.padStart(20),
  );

  // Sanity check row counts match
  if (s.name.includes('create') || s.name.includes('append') || s.name.includes('clear')) {
    if (compiledTsx.rowCount() !== vanilla.rowCount() || ours.rowCount() !== vanilla.rowCount()) {
      throw new Error(`row count mismatch after ${s.name}`);
    }
  }
}

console.log('\nregistry size after bench:', [..._internals().registry.keys()].length);
_internals().registry.forEach((_, id) => unregister(id));
