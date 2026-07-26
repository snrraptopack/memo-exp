/**
 * Measures selective replay of independent component-local derivations.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { compile } from '@memoized-dom/compiler';
import {
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime';

const DERIVATIONS = 32;
const SAMPLES = 7;
const WARMUPS = 250;
const ITERATIONS = 1_500;
const outDir = new URL('./dist/', import.meta.url);

mkdirSync(outDir, { recursive: true });

const state = Array.from(
  { length: DERIVATIONS },
  (_, index) => `let source${index} = ${index};`,
).join('\n');
const derived = Array.from(
  { length: DERIVATIONS },
  (_, index) => `const derived${index} = derive(source${index});`,
).join('\n');
const sum = Array.from(
  { length: DERIVATIONS },
  (_, index) => `derived${index}`,
).join(' + ');

const source = `
  function derive(input) {
    let value = input >>> 0;
    for (let index = 0; index < 128; index++) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    }
    return value;
  }

  export function App() {
    ${state}
    let unrelated = 0;
    ${derived}
    return <main>
      <button id="related" onClick={() => source0++}>related</button>
      <button id="unrelated" onClick={() => unrelated++}>unrelated</button>
      <output id="source">{source0}</output>
      <output id="other">{unrelated}</output>
      <output id="sum">{${sum}}</output>
    </main>;
  }
`;

writeFileSync(
  new URL('app.ts', outDir),
  compile(source, {
    runtimePath: '@memoized-dom/runtime',
    moduleId: './bench/local-derived/App.tsx',
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

const { App } = await import('./dist/app.ts');

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measure(buttonId: 'related' | 'unrelated'): number {
  const root = App('App', null) as HTMLElement;
  document.body.appendChild(root);
  const button = root.querySelector<HTMLButtonElement>(`#${buttonId}`)!;
  const output = root.querySelector<HTMLOutputElement>(
    buttonId === 'related' ? '#source' : '#other',
  )!;
  const initial = Number(output.textContent);
  for (let index = 0; index < WARMUPS; index++) button.click();
  const start = performance.now();
  for (let index = 0; index < ITERATIONS; index++) button.click();
  const elapsed = performance.now() - start;
  const expected = String(initial + WARMUPS + ITERATIONS);
  if (output.textContent !== expected) {
    throw new Error(
      `local-derived mismatch: ${output.textContent} !== ${expected}`,
    );
  }
  unregister('App');
  root.remove();
  return (elapsed * 1_000_000) / ITERATIONS;
}

try {
  measure('related');
  measure('unrelated');
  const related: number[] = [];
  const unrelated: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    related.push(measure('related'));
    unrelated.push(measure('unrelated'));
  }

  console.log('\nLOCAL DERIVED REPLAY (production output, median of 7)\n');
  console.log(
    'update'.padEnd(20),
    'time'.padStart(14),
  );
  console.log('-'.repeat(35));
  console.log(
    'one dependency'.padEnd(20),
    `${median(related).toFixed(1)}ns`.padStart(14),
  );
  console.log(
    'unrelated state'.padEnd(20),
    `${median(unrelated).toFixed(1)}ns`.padStart(14),
  );
  console.log(`\n${DERIVATIONS} independent derivations, 128 integer rounds each.`);
} finally {
  unregister('App');
  resetScheduler();
  window.close();
}
