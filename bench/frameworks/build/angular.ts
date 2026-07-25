/**
 * @file angular.ts
 * Runs Angular's AOT compiler and returns its generated browser entry.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function compileAngular(root: string): string {
  const executable = resolve(root, 'node_modules/.bin/ngc.exe');
  const result = spawnSync(executable, ['-p', resolve(root, 'angular-tsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Angular AOT compilation failed:\n${result.stdout}\n${result.stderr}`);
  }
  return resolve(root, 'dist/angular-aot/entries/angular.js');
}

