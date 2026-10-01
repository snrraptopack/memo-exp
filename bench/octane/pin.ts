import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const directory = import.meta.dirname;
export const repository = resolve(directory, '../..');
export const upstream = resolve(directory, 'upstream');
export const fixtureDirectory = resolve(upstream, 'benchmarks/js-framework');
export const upstreamCommit = '874ca5f139c6ed6f29b4970a567bc7e22b0b3ca4';
export const pnpmVersion = '11.15.1';
export const targetNames = ['octane-tsrx', 'octane-jsx', 'react', 'ripple',
  'solid', 'vue-vapor', 'preact', 'svelte', 'inferno', 'memoized-dom'] as const;

export function git(args: string[], cwd = repository): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
export function assertPin(): void {
  if (git(['rev-parse', 'HEAD'], upstream) !== upstreamCommit) {
    throw new Error('Octane checkout differs from the benchmark pin. Run bun run bench:octane:setup.');
  }
  if (git(['status', '--porcelain', '--untracked-files=no'], upstream)) {
    throw new Error('Octane has tracked edits. Restore or save them before benchmarking the pinned source.');
  }
}
