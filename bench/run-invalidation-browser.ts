/**
 * Prototype benchmark for compiler-generated per-entity dirty-reason masks.
 *
 * This intentionally does NOT modify production compiler/runtime behavior.
 * It isolates update evaluation in real Chromium:
 *   current - R14-style unconditional local derivation/slot evaluation
 *   masked  - compiler-known dirty bits gate the same work
 *
 * Every pair is checked operation-by-operation before it is timed.
 */
import puppeteer from 'puppeteer-core';

interface BenchRow {
  name: string;
  currentNs: number;
  maskedNs: number;
  speedup: number;
  iterationsCurrent: number;
  iterationsMasked: number;
}

const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium');

const browser = await puppeteer.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  headless: true,
});

try {
  const page = await browser.newPage();
  const rows = await page.evaluate(() => {
    type Op = () => number;
    type Pair = { current: Op; masked: Op };

    const median = (xs: number[]): number => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };

    // Keep results observable outside the hot loop.
    let sink = 0;

    function calibrate(op: Op): number {
      let iterations = 1;
      let elapsed = 0;
      while (iterations < 50_000_000) {
        const start = performance.now();
        let local = 0;
        for (let i = 0; i < iterations; i++) local += op();
        elapsed = performance.now() - start;
        sink += local;
        if (elapsed >= 20) break;
        iterations *= 2;
      }
      const target = Math.max(1, Math.round(iterations * (50 / Math.max(elapsed, 0.01))));
      return Math.min(target, 50_000_000);
    }

    function measure(op: Op): { ns: number; iterations: number } {
      // Warm each independently because favorable masked cases execute far
      // more operations per millisecond than the unconditional form.
      for (let i = 0; i < 2_000; i++) sink += op();
      const iterations = calibrate(op);
      const samples: number[] = [];
      for (let sample = 0; sample < 11; sample++) {
        const start = performance.now();
        let local = 0;
        for (let i = 0; i < iterations; i++) local += op();
        const elapsed = performance.now() - start;
        sink += local;
        samples.push((elapsed * 1_000_000) / iterations);
      }
      return { ns: median(samples), iterations };
    }

    function verify(makePair: () => Pair): void {
      const { current, masked } = makePair();
      for (let i = 0; i < 257; i++) {
        const a = current();
        const b = masked();
        if (!Object.is(a, b)) {
          throw new Error(`prototype mismatch at operation ${i}: ${a} !== ${b}`);
        }
      }
    }

    function heavyFilterPair(write: 'unrelated' | 'source'): Pair {
      function make(masked: boolean): Op {
        const rows = Array.from({ length: 2_000 }, (_, id) => ({
          id,
          done: (id & 3) === 0,
        }));
        let cursor = 0;
        let unrelated = 0;
        let active = rows.filter((row) => !row.done);
        let activeLength = active.length;
        let label = 0;
        let dirty = 0;
        const SOURCE = 1;
        const UNRELATED = 2;

        return () => {
          if (write === 'source') {
            const row = rows[cursor++ % rows.length]!;
            row.done = !row.done;
            if (masked) dirty |= SOURCE;
          } else {
            unrelated++;
            if (masked) dirty |= UNRELATED;
          }

          if (!masked) {
            active = rows.filter((row) => !row.done);
            activeLength = active.length;
            label = unrelated & 255;
          } else {
            const pending = dirty;
            dirty = 0;
            if (pending & SOURCE) {
              active = rows.filter((row) => !row.done);
              activeLength = active.length;
            }
            if (pending & UNRELATED) label = unrelated & 255;
          }
          return activeLength + label;
        };
      }
      return { current: make(false), masked: make(true) };
    }

    function slotGroupPair(write: 'unrelated' | 'one-source' | 'all'): Pair {
      function make(masked: boolean): Op {
        let sourceA = 1;
        let sourceB = 1;
        const cache = new Int32Array(33);
        for (let i = 0; i < 32; i++) {
          cache[i] = Math.imul(sourceA + i, 31 + i) ^ (sourceA >>> (i & 7));
        }
        cache[32] = sourceB & 1023;
        let dirty = 0;
        const A = 1;
        const B = 2;

        return () => {
          if (write === 'unrelated') {
            sourceB++;
            if (masked) dirty |= B;
          } else if (write === 'one-source') {
            sourceA++;
            if (masked) dirty |= A;
          } else {
            sourceA++;
            sourceB++;
            if (masked) dirty |= A | B;
          }

          if (!masked || (dirty & A) !== 0) {
            for (let i = 0; i < 32; i++) {
              const next = Math.imul(sourceA + i, 31 + i) ^ (sourceA >>> (i & 7));
              if (cache[i] !== next) cache[i] = next;
            }
          }
          if (!masked || (dirty & B) !== 0) {
            const next = sourceB & 1023;
            if (cache[32] !== next) cache[32] = next;
          }
          dirty = 0;
          // Sample several guarded results so the evaluated cache remains
          // observable without walking a group that the mask skipped.
          return cache[0]! + cache[15]! + cache[31]! + cache[32]!;
        };
      }
      return { current: make(false), masked: make(true) };
    }

    function tinyPair(): Pair {
      function make(masked: boolean): Op {
        let source = 1;
        let cached = 2;
        let dirty = 0;
        return () => {
          source++;
          if (masked) dirty |= 1;
          if (!masked || (dirty & 1) !== 0) {
            const next = source * 2;
            if (cached !== next) cached = next;
          }
          dirty = 0;
          return cached;
        };
      }
      return { current: make(false), masked: make(true) };
    }

    const scenarios: Array<{ name: string; make: () => Pair }> = [
      { name: 'filter(2k), unrelated write', make: () => heavyFilterPair('unrelated') },
      { name: 'filter(2k), source write', make: () => heavyFilterPair('source') },
      { name: '32 slots, unrelated group', make: () => slotGroupPair('unrelated') },
      { name: '32 slots, source group', make: () => slotGroupPair('one-source') },
      { name: '32 slots, all groups', make: () => slotGroupPair('all') },
      { name: 'single cheap slot', make: tinyPair },
    ];

    const output: BenchRow[] = [];
    for (const scenario of scenarios) {
      verify(scenario.make);
      const current = measure(scenario.make().current);
      const masked = measure(scenario.make().masked);
      output.push({
        name: scenario.name,
        currentNs: current.ns,
        maskedNs: masked.ns,
        speedup: current.ns / masked.ns,
        iterationsCurrent: current.iterations,
        iterationsMasked: masked.iterations,
      });
    }
    (window as unknown as { __maskBenchSink: number }).__maskBenchSink = sink;
    return output;
  });

  console.log('\nDIRTY-REASON MASK PROTOTYPE (real Chromium, median of 11)\n');
  console.log(
    'scenario'.padEnd(34),
    'current'.padStart(12),
    'masked'.padStart(12),
    'speedup'.padStart(10),
  );
  console.log('-'.repeat(72));
  for (const row of rows) {
    console.log(
      row.name.padEnd(34),
      `${row.currentNs.toFixed(1)}ns`.padStart(12),
      `${row.maskedNs.toFixed(1)}ns`.padStart(12),
      `${row.speedup.toFixed(2)}x`.padStart(10),
    );
  }
  console.log('\nPrototype only: scheduler, access routing, and real DOM writes are excluded.');
} finally {
  await browser.close();
}
