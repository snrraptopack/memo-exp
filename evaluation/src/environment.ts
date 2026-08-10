import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { artifactRoot, writeResult } from './shared';

function git(...args: string[]): string | null {
  for (const executable of ['git.exe', 'git']) {
    try {
      const result = Bun.spawnSync([executable, ...args], {
        cwd: resolve(artifactRoot, '..'),
        stdout: 'pipe',
        stderr: 'ignore',
      });
      if (result.exitCode === 0) return result.stdout.toString().trim();
    } catch {
      // Git metadata is useful but non-essential to running the artifact.
    }
  }
  return null;
}

const environment = {
  generatedAt: new Date().toISOString(),
  runtime: `Bun ${Bun.version}`,
  nodeCompatibility: process.version,
  platform: process.platform,
  architecture: process.arch,
  cpu: cpus()[0]?.model ?? 'unknown',
  logicalCpus: cpus().length,
  gitCommit: git('rev-parse', 'HEAD'),
  gitDirty: (git('status', '--porcelain') ?? '').length > 0,
  benchmarkPolicy: {
    deterministicTopologies: true,
    warmupRoutes: 1024,
    timingSamples: 9,
    lifecycleSamples: 7,
  },
};

await writeResult('environment.json', `${JSON.stringify(environment, null, 2)}\n`);
console.log(JSON.stringify(environment, null, 2));
