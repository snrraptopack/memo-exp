/**
 * @file build-todo.ts
 * Compiles the complete multi-module todo graph into examples/generated.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModules } from '../compiler/linker';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceFiles = ['db.ts', 'api.ts', 'TodoItem.tsx', 'todo.tsx'];
const sources = Object.fromEntries(
  sourceFiles.map((file) => [
    `/examples/${file}`,
    readFileSync(resolve(__dirname, file), 'utf-8'),
  ]),
);
const output = compileModules(sources, {
  rootId: 'TodoApp',
  runtimePath: '../../src/runtime',
});
const generatedDir = resolve(__dirname, 'generated');
mkdirSync(generatedDir, { recursive: true });

for (const file of sourceFiles) {
  const id = `/examples/${file}`;
  const outputFile = file.replace(/\.tsx$/, '.ts');
  writeFileSync(
    resolve(generatedDir, outputFile),
    `// @ts-nocheck
/**
 * Generated from examples/${file}; rebuild with bun run examples/build-todo.ts.
 */
${output[id]}
`,
    'utf-8',
  );
}

console.log(
  `Successfully compiled ${sourceFiles.length} todo modules into examples/generated.`,
);
