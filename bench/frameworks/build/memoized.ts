/**
 * @file memoized.ts
 * Compiles the authored memoized-dom TSX into temporary benchmark material.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';

export function compileMemoized(root: string): string {
  const sourceId = './bench/frameworks/dist/memoized.generated.ts';
  const modelId = './bench/frameworks/model.ts';
  const source = readFileSync(resolve(root, 'adapters/memoized.tsx'), 'utf8');
  const model = readFileSync(resolve(root, 'model.ts'), 'utf8');
  const compiled = compileModules(
    {
      [sourceId]: source,
      [modelId]: model,
      './bench/frameworks/dist/entry.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { MemoizedApp } from './memoized.generated';
        mount('app', MemoizedApp);
      `,
    },
    { runtimePath: '@memoized-dom/runtime' },
  )[sourceId]!;

  const bootstrap = `
import { setScheduler } from '@memoized-dom/runtime';
const target = document.querySelector('#app');
target.appendChild(MemoizedApp('MemoizedApp', null));
let currentMode = 'reactive';
function configureScheduler(mode) {
  currentMode = mode;
  setScheduler(mode === 'forced' ? (run) => run() : (run) => queueMicrotask(run));
}
window.__frameworkBench = {
  id: 'memoized-dom',
  label: 'memoized-dom TSX',
  version: 'workspace',
  reset(count, mode) {
    configureScheduler(mode);
    memoizedControls.reset(count, mode);
    return mode === 'reactive' ? Promise.resolve() : undefined;
  },
  run(scenario) {
    memoizedControls.run(scenario);
    return currentMode === 'reactive' ? Promise.resolve() : undefined;
  },
  validate() {
    return {
      rows: target.querySelectorAll('li').length,
      firstTitle: target.querySelector('li')?.textContent?.trim() ?? '',
      order: Array.from(target.querySelectorAll('li'), (row) => row.dataset.id).join(','),
      remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
      state: Array.from(target.querySelectorAll('li'), (row) => \`\${row.dataset.id}:\${row.classList.contains('completed') ? 1 : 0}:\${row.textContent?.trim() ?? ''}\`).join('|'),
    };
  },
};
`;
  const output = resolve(root, 'dist/memoized.generated.ts');
  writeFileSync(output, `${compiled}\n${bootstrap}`, 'utf8');
  return output;
}
