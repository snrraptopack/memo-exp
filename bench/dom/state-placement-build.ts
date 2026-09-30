/** Compile every authored state-placement benchmark through the linker. */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';

const directory = dirname(fileURLToPath(import.meta.url));
const dataSource = readFileSync(resolve(directory, 'data.ts'), 'utf-8');
const variants = [
  ['AppOwned', 'BenchAppOwned', 'compiled-owned-app', 'createCompiledOwnedApp'],
  ['AppInlineOwned', 'BenchAppInlineOwned', 'compiled-inline-owned-app', 'createCompiledInlineOwnedApp'],
  ['AppModuleDataComponent', 'BenchModuleDataComponent', 'compiled-module-data-component', 'createModuleDataComponent'],
  ['AppModuleDataInline', 'BenchModuleDataInline', 'compiled-module-data-inline', 'createModuleDataInline'],
  ['AppModuleSelectionComponent', 'BenchModuleSelectionComponent', 'compiled-module-selection-component', 'createModuleSelectionComponent'],
  ['AppModuleSelectionInline', 'BenchModuleSelectionInline', 'compiled-module-selection-inline', 'createModuleSelectionInline'],
] as const;

for (const [file, component, output, factory] of variants) {
  const moduleId = `./bench/dom/${file}.tsx`;
  const compiled = compileModules({
    [moduleId]: readFileSync(resolve(directory, `${file}.tsx`), 'utf-8'),
    './bench/dom/data.ts': dataSource,
    './bench/dom/entry.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { ${component} } from './${file}';
      mount('root', ${component});
    `,
  }, { runtimePath: '@memoized-dom/runtime' })[moduleId]!;
  writeFileSync(resolve(directory, `${output}.ts`), `/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
${compiled}

export function ${factory}() {
  const root = ${component}('${component}', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(\`Button '\${name}' not found in ${file}\`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
`, 'utf-8');
}
console.log('Successfully compiled six additional state-placement variants.');
