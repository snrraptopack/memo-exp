/**
 * @file build-todo.ts
 * Compiles examples/todo.tsx using compiler/compile.ts into examples/compiled-todo.ts.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../compiler/compile';

const __dirname = dirname(fileURLToPath(import.meta.url));

const todoSource = readFileSync(resolve(__dirname, 'todo.tsx'), 'utf-8');
const compiledTodo = compile(todoSource, { rootId: 'TodoApp', runtimePath: '../src/runtime' });

const outputContent = `/**
 * Generated Compiled Output for examples/todo.tsx
 */
${compiledTodo}
`;

writeFileSync(resolve(__dirname, 'compiled-todo.ts'), outputContent, 'utf-8');
console.log('Successfully compiled examples/todo.tsx into examples/compiled-todo.ts!');
