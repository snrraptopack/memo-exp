/**
 * @file build-bench.ts
 * Node/Bun pre-build step for benchmark.
 * Compiles bench/App.tsx and bench/AppInline.tsx using compiler/compile.ts
 * and writes the compiled output to compiled-tsx-app.ts and compiled-inline-app.ts.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../compiler/compile';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Compile App.tsx
const appTsxSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
const compiledAppTsx = compile(appTsxSource, { rootId: 'AppTsx', runtimePath: '../src/runtime' });

const compiledTsxAppContent = `${compiledAppTsx}

export function createCompiledTsxApp() {
  const root = BenchApp('AppTsx', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(\`Button '\${name}' not found in compiled app\`);
      b.click();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}
`;

writeFileSync(resolve(__dirname, 'compiled-tsx-app.ts'), compiledTsxAppContent, 'utf-8');

// 2. Compile AppInline.tsx
const appInlineSource = readFileSync(resolve(__dirname, 'AppInline.tsx'), 'utf-8');
const compiledAppInline = compile(appInlineSource, { rootId: 'AppInline', runtimePath: '../src/runtime' });

const compiledInlineAppContent = `${compiledAppInline}

export function createCompiledInlineApp() {
  const root = BenchAppInline('AppInline', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(\`Button '\${name}' not found in compiled inline app\`);
      b.click();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}
`;

writeFileSync(resolve(__dirname, 'compiled-inline-app.ts'), compiledInlineAppContent, 'utf-8');

console.log('Successfully pre-compiled bench/App.tsx and bench/AppInline.tsx using latest compiler!');
