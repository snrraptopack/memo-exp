/** Isolated compiler/runtime sources; both builds use today's authored adapter. */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { memoizedSources, type MemoizedBuildOptions } from './build';
import { git, repository } from './pin';
import { command } from './process';

export async function prepareComparison(ref: string, output: string): Promise<{
  beforeCommit: string; beforeRoot: string; adapterSha256: string;
  before: MemoizedBuildOptions; after: MemoizedBuildOptions;
}> {
  const beforeCommit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!/^[a-f0-9]{40,64}$/.test(beforeCommit)) throw new Error('Invalid baseline commit');
  // Snapshot source resolution shares the installed dependencies. Refuse to
  // mislabel a changed dependency graph as a compiler/runtime comparison.
  const lock = readFileSync(resolve(repository, 'bun.lock'), 'utf8').trim();
  if (git(['show', `${beforeCommit}:bun.lock`]) !== lock) {
    throw new Error('Baseline dependencies differ; use separately installed checkouts for this comparison');
  }
  const beforeRoot = resolve(output, 'baseline');
  mkdirSync(beforeRoot, { recursive: true });
  const archive = resolve(beforeRoot, 'source.tar');
  git(['archive', `--output=${archive}`, beforeCommit, 'packages/compiler', 'packages/runtime']);
  await command('tar', ['-xf', archive, '-C', beforeRoot], repository);
  const beforeCompiler = await import(pathToFileURL(resolve(beforeRoot, 'packages/compiler/src/index.ts')).href);
  const afterCompiler = await import(pathToFileURL(resolve(repository, 'packages/compiler/src/index.ts')).href);
  const sources = memoizedSources();
  return {
    beforeCommit, beforeRoot, adapterSha256: createHash('sha256').update(JSON.stringify(sources)).digest('hex'),
    before: { compiler: beforeCompiler.compileModules,
      runtimeEntry: resolve(beforeRoot, 'packages/runtime/src/index.ts'), output: resolve(output, 'before'), sources },
    after: { compiler: afterCompiler.compileModules,
      runtimeEntry: resolve(repository, 'packages/runtime/src/index.ts'), output: resolve(output, 'after'), sources },
  };
}
