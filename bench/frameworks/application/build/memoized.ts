import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';

export function compileMemoizedApplication(root: string): string {
  const sourceId =
    './bench/frameworks/application/dist/memoized.generated.ts';
  const modelId = './bench/frameworks/application/model.ts';
  const source = readFileSync(
    resolve(root, 'adapters/memoized.tsx'),
    'utf8',
  );
  const model = readFileSync(resolve(root, 'model.ts'), 'utf8');
  const compiled = compileModules(
    {
      [sourceId]: source,
      [modelId]: model,
      './bench/frameworks/application/dist/entry.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { ApplicationApp } from './memoized.generated';
        mount('app', ApplicationApp);
      `,
    },
    { runtimePath: '@memoized-dom/runtime' },
  )[sourceId]!;

  const bootstrap = `
import { setScheduler } from '@memoized-dom/runtime';
import { readApplicationDom } from '../dom-validation';
import { dispatchApplicationScenario } from '../events';
const target = document.querySelector('#app');
setScheduler((run) => queueMicrotask(run));
target.appendChild(ApplicationApp('ApplicationApp', null));
window.__applicationBench = {
  id: 'memoized-dom',
  label: 'memoized-dom TSX',
  version: 'workspace',
  reset(count, scenario) {
    applicationControls.reset(count, scenario);
    return Promise.resolve();
  },
  run(scenario) {
    dispatchApplicationScenario(target, scenario);
    return Promise.resolve();
  },
  validate() {
    return readApplicationDom(target);
  },
};
`;
  const output = resolve(root, 'dist/memoized.generated.ts');
  writeFileSync(output, `${compiled}\n${bootstrap}`, 'utf8');
  return output;
}
