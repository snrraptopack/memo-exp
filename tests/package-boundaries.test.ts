/**
 * Guards the compiler/runtime workspace ownership and public package defaults.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '@memoized-dom/compiler';

const root = resolve(import.meta.dirname, '..');

function manifest(packageName: 'compiler' | 'runtime'): {
  dependencies?: Record<string, string>;
  exports: Record<string, unknown>;
} {
  return JSON.parse(
    readFileSync(
      resolve(root, `packages/${packageName}/package.json`),
      'utf8',
    ),
  );
}

function typeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return typeScriptSources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('workspace package boundaries', () => {
  it('keeps the production runtime dependency-free', () => {
    expect(manifest('runtime').dependencies).toBeUndefined();
  });

  it('keeps compiler source independent from runtime source', () => {
    const compiler = manifest('compiler');
    expect(compiler.dependencies).not.toHaveProperty('@memoized-dom/runtime');

    for (const file of typeScriptSources(
      resolve(root, 'packages/compiler/src'),
    )) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(
        /(?:from\s+|import\s*\()['"]@memoized-dom\/runtime/,
      );
      expect(source).not.toContain('packages/runtime');
    }
  });

  it('emits the public runtime package by default', () => {
    const output = compile(`
      let count = 0;
      export function App() {
        return <button onClick={() => count++}>{count}</button>;
      }
    `);
    expect(output).toContain(
      'import * as _MD from "@memoized-dom/runtime"',
    );
  });

  it('publishes production and testing runtime subpaths separately', () => {
    expect(manifest('runtime').exports).toHaveProperty('.');
    expect(manifest('runtime').exports).toHaveProperty('./testing');
    expect(manifest('compiler').exports).toHaveProperty('.');
  });
});
