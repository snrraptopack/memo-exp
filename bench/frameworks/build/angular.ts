/**
 * @file angular.ts
 * Runs Angular's AOT compiler and returns its generated browser entry.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function compileAngular(root: string): string {
  const packageRoot = resolve(root, 'node_modules/@angular/compiler-cli');
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
  ) as { bin: { ngc: string } };
  const executable = resolve(packageRoot, manifest.bin.ngc);
  const result = spawnSync('node', [executable, '-p', resolve(root, 'angular-tsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Angular AOT compilation failed:\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return resolve(root, 'dist/angular-aot/entries/angular.js');
}

