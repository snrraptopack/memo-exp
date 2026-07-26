/**
 * Production benchmark for same-file versus graph-linked component factories.
 *
 * Both variants compile normal TSX and execute the same factory ABI under
 * happy-dom. Runtime rows isolate whether cross-file linking adds an adapter;
 * compiler rows record the separate graph-linking cost.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { compile } from '../../compiler/compile';
import { compileModules } from '../../compiler/linker';
import {
  resetScheduler,
  setScheduler,
  unregister,
} from '../../src/kernel';

const outDir = new URL('./dist/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const childSource = `
  export function Child() {
    let count = 0;
    return <button onClick={() => count++}>{count}</button>;
  }
`;
const appSource = `
  import { Child } from './child';
  export function App() {
    return <main><Child /></main>;
  }
`;
const sameFileSource = `
  function Child() {
    let count = 0;
    return <button onClick={() => count++}>{count}</button>;
  }
  export function App() {
    return <main><Child /></main>;
  }
`;
const splitSources = {
  './bench/components/child.tsx': childSource,
  './bench/components/app.tsx': appSource,
};

writeFileSync(
  new URL('same.ts', outDir),
  compile(sameFileSource, {
    runtimePath: '../../../src/runtime',
    moduleId: './bench/components/same.tsx',
  }),
);
const splitOutput = compileModules(splitSources, {
  runtimePath: '../../../src/runtime',
});
writeFileSync(new URL('child.ts', outDir), splitOutput['./bench/components/child.tsx']!);
writeFileSync(new URL('app.ts', outDir), splitOutput['./bench/components/app.tsx']!);

const window = new Window();
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Event: window.Event,
});
setScheduler((commit) => commit());

const { App: SameApp } = await import('./dist/same.ts');
const { App: SplitApp } = await import('./dist/app.ts');

const SAMPLE_COUNT = 11;
const MOUNT_ITERATIONS = 2_000;
const UPDATE_ITERATIONS = 50_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
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
  const button = root.querySelector('button')!;
  for (let i = 0; i < 2_000; i++) button.click();
  const start = performance.now();
  for (let i = 0; i < UPDATE_ITERATIONS; i++) button.click();
  const elapsed = performance.now() - start;
  if (button.textContent !== String(UPDATE_ITERATIONS + 2_000)) {
    throw new Error(`component benchmark mismatch: ${button.textContent}`);
  }
  unregister(id);
  root.remove();
  return (elapsed * 1_000_000) / UPDATE_ITERATIONS;
}

try {
  measureMount(SameApp, 'warm-same');
  measureMount(SplitApp, 'warm-split');

  const sameMount: number[] = [];
  const splitMount: number[] = [];
  const sameUpdate: number[] = [];
  const splitUpdate: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
    sameMount.push(measureMount(SameApp, `same-${sample}`));
    splitMount.push(measureMount(SplitApp, `split-${sample}`));
    sameUpdate.push(measureUpdates(SameApp, `same-update-${sample}`));
    splitUpdate.push(measureUpdates(SplitApp, `split-update-${sample}`));
  }

  const sameCompile: number[] = [];
  const splitCompile: number[] = [];
  for (let sample = 0; sample < 7; sample++) {
    if ((sample & 1) === 0) {
      sameCompile.push(time(() => compile(sameFileSource)));
      splitCompile.push(time(() => compileModules(splitSources)));
    } else {
      splitCompile.push(time(() => compileModules(splitSources)));
      sameCompile.push(time(() => compile(sameFileSource)));
    }
  }

  console.log('\nCROSS-FILE COMPONENTS (production output, median)\n');
  console.log(
    'scenario'.padEnd(24),
    'same file'.padStart(14),
    'linked'.padStart(14),
    'relative'.padStart(12),
  );
  console.log('-'.repeat(67));
  const rows = [
    ['mount + unmount', median(sameMount), median(splitMount), 'ns'],
    ['local text update', median(sameUpdate), median(splitUpdate), 'ns'],
    ['compile graph', median(sameCompile), median(splitCompile), 'ms'],
  ] as const;
  for (const [name, same, split, unit] of rows) {
    console.log(
      name.padEnd(24),
      `${same.toFixed(1)}${unit}`.padStart(14),
      `${split.toFixed(1)}${unit}`.padStart(14),
      `${(split / same).toFixed(2)}x`.padStart(12),
    );
  }
} finally {
  resetScheduler();
  window.close();
}
