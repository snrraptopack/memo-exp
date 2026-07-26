/**
 * Production benchmark for module-owned versus instance-owned collection rows.
 *
 * Both compiled applications render 100 keyed component rows and a derivation
 * of the first item. A row item-field write must refresh that row and owner;
 * the benchmark measures the two ownership/routing implementations.
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

const row = `
  function Row(item) {
    return <button class="row" onClick={() => item.value++}>{item.value}</button>;
  }
`;
const moduleSource = `
  ${row}
  let items = Array.from({ length: 100 }, (_, id) => ({ id, value: 0 }));
  const firstValue = items[0].value;
  export function App() {
    return <main>
      <output>{firstValue}</output>
      <div>{items.map(item => <Row key={item.id} item={item} />)}</div>
    </main>;
  }
`;
const localSource = `
  ${row}
  export function App() {
    let items = Array.from({ length: 100 }, (_, id) => ({ id, value: 0 }));
    const firstValue = items[0].value;
    return <main>
      <output>{firstValue}</output>
      <div>{items.map(item => <Row key={item.id} item={item} />)}</div>
    </main>;
  }
`;

writeFileSync(
  new URL('module.ts', outDir),
  compile(moduleSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/local-state/module.tsx',
  }),
);
writeFileSync(
  new URL('local.ts', outDir),
  compile(localSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/local-state/local.tsx',
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

const { App: ModuleApp } = await import('./dist/module.ts');
const { App: LocalApp } = await import('./dist/local.ts');

const SAMPLE_COUNT = 7;
const MOUNT_ITERATIONS = 100;
const UPDATE_ITERATIONS = 2_000;
const UPDATE_WARMUPS = 500;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureMount(
  factory: (id: string, parent: string | null) => HTMLElement,
): number {
  const start = performance.now();
  for (let iteration = 0; iteration < MOUNT_ITERATIONS; iteration++) {
    const root = factory('App', null);
    document.body.appendChild(root);
    unregister('App');
    root.remove();
  }
  return ((performance.now() - start) * 1_000_000) / MOUNT_ITERATIONS;
}

function measureUpdates(
  factory: (id: string, parent: string | null) => HTMLElement,
): number {
  const root = factory('App', null);
  document.body.appendChild(root);
  const rowButton = root.querySelector<HTMLButtonElement>('.row')!;
  const output = root.querySelector('output')!;
  const initial = Number(output.textContent);
  for (let iteration = 0; iteration < UPDATE_WARMUPS; iteration++) {
    rowButton.click();
  }
  const start = performance.now();
  for (let iteration = 0; iteration < UPDATE_ITERATIONS; iteration++) {
    rowButton.click();
  }
  const elapsed = performance.now() - start;
  const expected = String(initial + UPDATE_ITERATIONS + UPDATE_WARMUPS);
  if (rowButton.textContent !== expected || output.textContent !== expected) {
    throw new Error(
      `local-state benchmark mismatch: ${rowButton.textContent}/${output.textContent} != ${expected}`,
    );
  }
  unregister('App');
  root.remove();
  return (elapsed * 1_000_000) / UPDATE_ITERATIONS;
}

try {
  measureMount(ModuleApp);
  measureMount(LocalApp);
  const moduleMount: number[] = [];
  const localMount: number[] = [];
  const moduleUpdate: number[] = [];
  const localUpdate: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    moduleMount.push(measureMount(ModuleApp));
    localMount.push(measureMount(LocalApp));
    moduleUpdate.push(measureUpdates(ModuleApp));
    localUpdate.push(measureUpdates(LocalApp));
  }

  console.log('\nLOCAL COLLECTION OWNERSHIP (production output, median of 7)\n');
  console.log(
    'scenario'.padEnd(24),
    'module'.padStart(14),
    'instance'.padStart(14),
    'relative'.padStart(12),
  );
  console.log('-'.repeat(67));
  const rows = [
    ['mount + unmount', median(moduleMount), median(localMount)],
    ['row + owner update', median(moduleUpdate), median(localUpdate)],
  ] as const;
  for (const [name, moduleTime, localTime] of rows) {
    console.log(
      name.padEnd(24),
      `${moduleTime.toFixed(1)}ns`.padStart(14),
      `${localTime.toFixed(1)}ns`.padStart(14),
      `${(localTime / moduleTime).toFixed(2)}x`.padStart(12),
    );
  }
} finally {
  unregister('App');
  resetScheduler();
  window.close();
}
