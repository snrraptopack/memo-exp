/**
 * @file build.ts
 * Node/Bun pre-build step for benchmark.
 * Compiles App.tsx and AppInline.tsx using the cross-module linker
 * and writes the compiled output to compiled-tsx-app.ts and compiled-inline-app.ts.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataSource = readFileSync(resolve(__dirname, 'data.ts'), 'utf-8');

// 1. Compile App.tsx
const appTsxSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
const compiledAppTsx = compileModules(
  {
    './bench/dom/App.tsx': appTsxSource,
    './bench/dom/data.ts': dataSource,
    './bench/dom/entry.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { BenchApp } from './App';
      mount('root', BenchApp);
    `,
  },
  { runtimePath: '@memoized-dom/runtime' },
)['./bench/dom/App.tsx']!;

const compiledTsxAppContent = `${compiledAppTsx}

export function createCompiledTsxApp() {
  const root = BenchApp('BenchApp', null) as HTMLElement;
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
const compiledAppInline = compileModules(
  {
    './bench/dom/AppInline.tsx': appInlineSource,
    './bench/dom/data.ts': dataSource,
    './bench/dom/entry-inline.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { BenchAppInline } from './AppInline';
      mount('root', BenchAppInline);
    `,
  },
  { runtimePath: '@memoized-dom/runtime' },
)['./bench/dom/AppInline.tsx']!;

const compiledInlineAppContent = `${compiledAppInline}

export function createCompiledInlineApp() {
  const root = BenchAppInline('BenchAppInline', null) as HTMLElement;
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

console.log('Successfully compiled the DOM benchmark sources.');
