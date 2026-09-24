/**
 * Guards the compiler/runtime workspace ownership and public package defaults.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '@memoized-dom/compiler';

const root = resolve(import.meta.dirname, '..');

function manifest(packageName: 'compiler' | 'data' | 'router' | 'runtime'): {
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
    expect(manifest('data').dependencies).toBeUndefined();
    expect(manifest('runtime').dependencies).toBeUndefined();
    expect(manifest('router').dependencies).toBeUndefined();
  });

  it('keeps compiler source independent from runtime source', () => {
    const compiler = manifest('compiler');
    expect(compiler.dependencies).not.toHaveProperty('@memoized-dom/runtime');
    expect(compiler.dependencies).toHaveProperty(
      '@memoized-dom/router',
      'workspace:*',
    );

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
    expect(manifest('data').exports).toHaveProperty('.');
    expect(manifest('data').exports).toHaveProperty('./internal');
    expect(manifest('router').exports).toHaveProperty('.');
    expect(manifest('router').exports).toHaveProperty('./internal');
  });

  it('publishes scoped data creation separately from generated-code hooks', async () => {
    const publicData = await import('@memoized-dom/data');
    const internalData = await import('@memoized-dom/data/internal');

    expect(publicData).toHaveProperty('createDataRuntime');
    expect(publicData).toHaveProperty('clearDataRuntime');
    expect(publicData).not.toHaveProperty('subscribeFetchResource');
    expect(publicData).not.toHaveProperty('subscribeActionResult');
    expect(internalData).toHaveProperty('subscribeFetchResource');
    expect(internalData).toHaveProperty('subscribeActionResult');
    expect(internalData).toHaveProperty('disposeFetchResource');
    expect(internalData).toHaveProperty('disposeActionResult');
  });

  it('publishes scoped router creation separately from generated-code hooks', async () => {
    const publicRouter = await import('@memoized-dom/router');
    const internalRouter = await import('@memoized-dom/router/internal');

    expect(publicRouter).toHaveProperty('createRouteRuntime');
    expect(publicRouter).not.toHaveProperty('installRouteResolver');
    expect(internalRouter).toHaveProperty('installRouteResolver');
  });
});
