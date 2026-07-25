/**
 * Production-output benchmark for compiler-owned component children slots.
 *
 * The runner compiles direct and wrapped JSX, executes both under happy-dom,
 * verifies their output, and measures mount/unmount and hot local updates.
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

const directSource = `
  export function App() {
    let count = 0;
    return <button onClick={() => count++}>{count}</button>;
  }
`;
const slottedSource = `
  function Frame(props) {
    return <section>{props.children}</section>;
  }
  export function App() {
    let count = 0;
    return <Frame>
      <button onClick={() => count++}>{count}</button>
    </Frame>;
  }
`;

writeFileSync(
  new URL('direct.compiled.ts', outDir),
  compile(directSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/children/direct.tsx',
  }),
);
writeFileSync(
  new URL('slotted.compiled.ts', outDir),
  compile(slottedSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/children/slotted.tsx',
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

const { App: DirectApp } = await import('./dist/direct.compiled.ts');
const { App: SlottedApp } = await import('./dist/slotted.compiled.ts');

const SAMPLE_COUNT = 11;
const MOUNT_ITERATIONS = 2_000;
const UPDATE_ITERATIONS = 50_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureMount(
  factory: (id: string, parent: string | null) => HTMLElement,
  prefix: string,
): number {
  const start = performance.now();
  for (let i = 0; i < MOUNT_ITERATIONS; i++) {
    const id = `${prefix}-${i}`;
    const root = factory(id, null);
    document.body.appendChild(root);
    unregister(id);
    root.remove();
  }
  return ((performance.now() - start) * 1_000_000) / MOUNT_ITERATIONS;
}

function measureUpdates(
  factory: (id: string, parent: string | null) => HTMLElement,
  id: string,
): number {
  const root = factory(id, null);
  document.body.appendChild(root);
  const button = root.matches('button') ? root : root.querySelector('button')!;
  for (let i = 0; i < 2_000; i++) button.click();

  const start = performance.now();
  for (let i = 0; i < UPDATE_ITERATIONS; i++) button.click();
  const elapsed = performance.now() - start;
  const expected = String(UPDATE_ITERATIONS + 2_000);
  if (button.textContent !== expected) {
    throw new Error(
      `children benchmark mismatch: ${button.textContent} !== ${expected}`,
    );
  }
  unregister(id);
  root.remove();
  return (elapsed * 1_000_000) / UPDATE_ITERATIONS;
}

try {
  measureMount(DirectApp, 'warm-direct');
  measureMount(SlottedApp, 'warm-slotted');

  const directMount: number[] = [];
  const slottedMount: number[] = [];
  const directUpdate: number[] = [];
  const slottedUpdate: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    directMount.push(measureMount(DirectApp, `direct-${sample}`));
    slottedMount.push(measureMount(SlottedApp, `slotted-${sample}`));
    directUpdate.push(measureUpdates(DirectApp, `direct-update-${sample}`));
    slottedUpdate.push(measureUpdates(SlottedApp, `slotted-update-${sample}`));
  }

  const rows = [
    ['mount + unmount', median(directMount), median(slottedMount)],
    ['local text update', median(directUpdate), median(slottedUpdate)],
  ] as const;
  console.log('\nCOMPONENT CHILDREN SLOTS (production output, median of 11)\n');
  console.log(
    'scenario'.padEnd(24),
    'direct'.padStart(14),
    'slotted'.padStart(14),
    'relative'.padStart(12),
  );
  console.log('-'.repeat(67));
  for (const [name, direct, slotted] of rows) {
    console.log(
      name.padEnd(24),
      `${direct.toFixed(1)}ns`.padStart(14),
      `${slotted.toFixed(1)}ns`.padStart(14),
      `${(slotted / direct).toFixed(2)}x`.padStart(12),
    );
  }
} finally {
  resetScheduler();
  window.close();
}
