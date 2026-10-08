import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { analyzeServerFunctionModule, parseWithEstreeFrontendOrThrow, memoizedEstreeFrontend } from '@memoized-dom/compiler';
import { resolveAdapterOptions } from '../src/options';
import { rewriteServerFunctionBarrelImports, serverFunctionsDeclarationFile, writeServerFunctionDeclarations } from '../src/server-functions';
import { routesDeclarationFile, writeRoutesDeclaration } from '../src/routes';

let fixture: string | undefined;
afterEach(async () => {
  if (fixture !== undefined) await rm(fixture, { recursive: true, force: true });
  fixture = undefined;
});

describe('server function barrel imports', () => {
  it('rewrites AST specifiers while preserving aliases, types, comments, and unrelated strings', () => {
    const source = `
      const example = "import { story } from '#server-functions'";
      import {
        /* Stories, including drafts */
        story /* alias, comment */ as selected,
        type Story,
        vote,
        unknown,
      } from '#server-functions';
      import type { User } from '#server-functions';
    `;
    const output = rewriteServerFunctionBarrelImports(source, [
      { exported: 'story', specifier: '/server/functions/stories.ts' },
      { exported: 'vote', specifier: '/server/functions/votes.ts' },
    ]);
    expect(output).toContain('/* Stories, including drafts */');
    expect(output).toContain('story /* alias, comment */ as selected');
    expect(output).toContain('import { type Story, unknown } from "#server-functions"');
    expect(output).toContain('import type { User } from \'#server-functions\'');
    expect(output).toContain('const example = "import { story } from \'#server-functions\'"');
    const program = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, output, { filename: 'app.ts' }).program;
    expect(program.body.filter(node => node.type === 'ImportDeclaration')).toHaveLength(4);
  });

  it('retains mixed default imports and leaves namespace imports alone', () => {
    const output = rewriteServerFunctionBarrelImports(`
      import fallback, { story as selected } from '#server-functions';
      import * as functions from '#server-functions';
    `, [{ exported: 'story', specifier: '/stories.ts' }]);
    expect(output).toContain('import fallback from "#server-functions"');
    expect(output).toContain('import { story as selected } from "/stories.ts"');
    expect(output).toContain("import * as functions from '#server-functions'");
  });
});

describe('conditional generated declarations', () => {
  it('creates no declaration files or directory when functions and routes are absent', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-declarations-'));
    await writeServerFunctionDeclarations(fixture, [], resolveAdapterOptions({ clientEntry: 'main.ts' }));
    await writeRoutesDeclaration(fixture, []);
    await expect(stat(resolve(fixture, '.memoized'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes stale declarations when their last function or route disappears', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-declarations-'));
    const options = resolveAdapterOptions({ clientEntry: 'main.ts' });
    const module = analyzeServerFunctionModule('/** @GET */ export async function story() {}', {
      moduleId: resolve(fixture, 'server/functions/stories.ts'),
    });
    await writeServerFunctionDeclarations(fixture, [module], options);
    await writeRoutesDeclaration(fixture, ['/stories/:id']);
    expect(await readFile(serverFunctionsDeclarationFile(fixture), 'utf8')).toContain('function story');
    expect(await readFile(routesDeclarationFile(fixture), 'utf8')).toContain('/stories/:id');
    await Promise.all([
      writeServerFunctionDeclarations(fixture, [], options),
      writeServerFunctionDeclarations(fixture, [], options),
      writeRoutesDeclaration(fixture, []),
      writeRoutesDeclaration(fixture, []),
    ]);
    await expect(stat(serverFunctionsDeclarationFile(fixture))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(routesDeclarationFile(fixture))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
