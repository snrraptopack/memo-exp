/**
 * Production-output benchmark for scalar and general JSX DOM paths.
 *
 * Both applications are authored as TSX and compiled before timing. The
 * explicit case uses specialized attribute emission; the spread case adds a
 * stable prop spread and therefore exercises the ordered DOM patcher.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { compile } from '../../compiler/compile';
import {
  resetScheduler,
  setScheduler,
  unregister,
} from '../../src/kernel';

const outDir = new URL('./dist/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const explicitSource = `
  export function App() {
    let count = 0;
    return <button
      id="target"
      aria-label="counter"
      class={["counter", { odd: count % 2 === 1 }]}
      style={{ width: count + 1, opacity: 0.5 }}
      tabIndex={count % 4}
      onClick={() => count++}
    >{count}</button>;
  }
`;

const spreadSource = `
  const base = { id: "target", "aria-label": "counter" };
  export function App() {
    let count = 0;
    return <button
      {...base}
      class={["counter", { odd: count % 2 === 1 }]}
      style={{ width: count + 1, opacity: 0.5 }}
      tabIndex={count % 4}
      onClick={() => count++}
    >{count}</button>;
  }
`;

writeFileSync(
  new URL('explicit.compiled.ts', outDir),
  compile(explicitSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/jsx/explicit.tsx',
  }),
);
writeFileSync(
  new URL('spread.compiled.ts', outDir),
  compile(spreadSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/jsx/spread.tsx',
  }),
);

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Event: window.Event,
});
setScheduler((commit) => commit());

const { App: ExplicitApp } = await import('./dist/explicit.compiled.ts');
const { App: SpreadApp } = await import('./dist/spread.compiled.ts');
const SAMPLE_COUNT = 9;
const MOUNT_ITERATIONS = 500;
const UPDATE_ITERATIONS = 5_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function verify(button: HTMLButtonElement, count: number): void {
  if (
    button.textContent !== String(count) ||
    button.id !== 'target' ||
    button.getAttribute('aria-label') !== 'counter' ||
    button.style.width !== `${count + 1}px` ||
    button.tabIndex !== count % 4 ||
    button.className !== (count % 2 === 1 ? 'counter odd' : 'counter')
  ) {
    throw new Error(`JSX benchmark output mismatch at count ${count}`);
  }
}

function measureMount(
  factory: (id: string, parent: string | null) => HTMLButtonElement,
  prefix: string,
): number {
  const start = performance.now();
  for (let index = 0; index < MOUNT_ITERATIONS; index++) {
    const id = `${prefix}-${index}`;
    const button = factory(id, null);
    document.body.appendChild(button);
    verify(button, 0);
    unregister(id);
    button.remove();
  }
  return ((performance.now() - start) * 1_000_000) / MOUNT_ITERATIONS;
}

function measureUpdates(
  factory: (id: string, parent: string | null) => HTMLButtonElement,
  id: string,
): number {
  const button = factory(id, null);
  document.body.appendChild(button);
  for (let index = 0; index < 500; index++) button.click();
  const start = performance.now();
  for (let index = 0; index < UPDATE_ITERATIONS; index++) button.click();
  const elapsed = performance.now() - start;
  verify(button, UPDATE_ITERATIONS + 500);
  unregister(id);
  button.remove();
  return (elapsed * 1_000_000) / UPDATE_ITERATIONS;
}

try {
  measureMount(ExplicitApp, 'warm-explicit');
  measureMount(SpreadApp, 'warm-spread');
  const explicitMount: number[] = [];
  const spreadMount: number[] = [];
  const explicitUpdate: number[] = [];
  const spreadUpdate: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    explicitMount.push(measureMount(ExplicitApp, `explicit-${sample}`));
    spreadMount.push(measureMount(SpreadApp, `spread-${sample}`));
    explicitUpdate.push(
      measureUpdates(ExplicitApp, `explicit-update-${sample}`),
    );
    spreadUpdate.push(
      measureUpdates(SpreadApp, `spread-update-${sample}`),
    );
  }

  const rows = [
    ['mount + unmount', median(explicitMount), median(spreadMount)],
    ['rich attribute update', median(explicitUpdate), median(spreadUpdate)],
  ] as const;
  console.log('\nAUTHORED JSX PATHS (production output, median of 9)\n');
  console.log(
    'scenario'.padEnd(24),
    'explicit'.padStart(14),
    'spread'.padStart(14),
    'relative'.padStart(12),
  );
  console.log('-'.repeat(67));
  for (const [name, explicit, spread] of rows) {
    console.log(
      name.padEnd(24),
      `${explicit.toFixed(1)}ns`.padStart(14),
      `${spread.toFixed(1)}ns`.padStart(14),
      `${(spread / explicit).toFixed(2)}x`.padStart(12),
    );
  }
} finally {
  resetScheduler();
  window.close();
}
