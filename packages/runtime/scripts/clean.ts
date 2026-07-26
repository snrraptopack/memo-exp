/**
 * Removes only this package's generated distribution directory.
 */
import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const dist = resolve(packageRoot, 'dist');

if (dirname(dist) !== packageRoot || basename(dist) !== 'dist') {
  throw new Error(`Refusing to clean unexpected path: ${dist}`);
}

rmSync(dist, { recursive: true, force: true });
