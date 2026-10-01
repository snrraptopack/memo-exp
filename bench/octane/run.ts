import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { assertPin, directory, fixtureDirectory, git, repository, targetNames, upstream, upstreamCommit, pnpmVersion } from './pin';
import { buildTargets } from './build';
import { command } from './process';
import { writeReport, type SuiteResult } from './report';

const args = process.argv.slice(2);
const known = args.filter(arg => !['--quick', '--smoke', '--canonical-only'].includes(arg)
  && !arg.startsWith('--targets=') && !arg.startsWith('--samples='));
if (known.length) throw new Error(`Unknown options: ${known.join(', ')}`);
const names = args.find(arg => arg.startsWith('--targets='))?.slice('--targets='.length).split(',') ?? [...targetNames];
if (!names.length || new Set(names).size !== names.length || names.some(name => !targetNames.includes(name as typeof targetNames[number]))) {
  throw new Error(`Targets must be unique names from: ${targetNames.join(', ')}`);
}
const samples = Number(args.find(arg => arg.startsWith('--samples='))?.slice('--samples='.length)
  ?? (args.includes('--smoke') ? 1 : args.includes('--quick') ? 3 : 8));
if (!Number.isInteger(samples) || samples < 1) throw new Error('--samples must be a positive integer');
assertPin();
const output = resolve(directory, 'results', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(output, { recursive: true });
const suites: SuiteResult[] = [];
const metadata: Record<string, unknown> = {
  measuredAt: new Date().toISOString(), upstreamCommit, memoizedCommit: git(['rev-parse', 'HEAD']),
  memoizedDirty: Boolean(git(['status', '--porcelain', '--untracked-files=no'])), pnpmVersion,
  upstreamLockSha256: createHash('sha256').update(readFileSync(resolve(upstream, 'pnpm-lock.yaml'))).digest('hex'),
  platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
  memoryBytes: totalmem(), bunVersion: Bun.version, targets: names, samples,
  canonicalCpuThrottle: Number(process.env.CPU_THROTTLE || 1),
  memoizedState: 'component-owned; inline keyed rows; immutable array operations; synchronous scheduler',
};
// Include the container's limits when available; host totals can overstate VM capacity.
for (const [name, path] of [['cpuQuota', '/sys/fs/cgroup/cpu.max'], ['memoryLimit', '/sys/fs/cgroup/memory.max']] as const) {
  if (existsSync(path)) metadata[name] = readFileSync(path, 'utf8').trim();
}
writeFileSync(resolve(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
const servers: ReturnType<typeof Bun.serve>[] = [];
try {
  const outputs = await buildTargets(names);
  metadata.runtimeVersions = Object.fromEntries(names.map(name => {
    const dependencies = name === 'memoized-dom'
      ? { '@memoized-dom/runtime': JSON.parse(readFileSync(resolve(repository, 'packages/runtime/package.json'), 'utf8')).version }
      : Object.fromEntries(Object.keys(JSON.parse(readFileSync(resolve(fixtureDirectory, name, 'package.json'), 'utf8')).dependencies ?? {})
        .map(dependency => [dependency, JSON.parse(readFileSync(resolve(fixtureDirectory, name, 'node_modules', dependency, 'package.json'), 'utf8')).version]));
    return [name, dependencies];
  }));
  const require = createRequire(resolve(fixtureDirectory, 'package.json'));
  const { chromium } = require('playwright');
  metadata.playwrightVersion = require('playwright/package.json').version;
  const browser = await chromium.launch({ headless: true });
  metadata.chromiumVersion = browser.version();
  await browser.close();
  const targets = names.map(name => {
    const root = outputs.get(name)!;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const path = resolve(root, '.' + decodeURIComponent(new URL(request.url).pathname));
      const location = relative(root, path);
      if (location === '..' || location.startsWith('..' + sep) || isAbsolute(location)) return new Response('Forbidden', { status: 403 });
      const file = resolve(path, existsSync(path) && statSync(path).isDirectory() ? 'index.html' : '');
      if (!existsSync(file) || !statSync(file).isFile()) return new Response('Not found', { status: 404 });
      return new Response(Bun.file(file));
    } });
    servers.push(server);
    return { name, url: `http://127.0.0.1:${server.port}/`, ready: '#run' };
  });
  const scripts = ['run.mjs', ...(args.includes('--canonical-only') ? [] : ['run-reorder.mjs'])];
  const failures: string[] = [];
  for (const script of scripts) {
    const result = resolve(output, script === 'run.mjs' ? 'canonical.json' : 'reorder.json');
    try {
      await command('node', [resolve(fixtureDirectory, script), String(samples)], fixtureDirectory, {
        TARGETS: JSON.stringify(targets), BENCH_JSON: result, CLEAR_1K: '0',
      });
    } catch (error) {
      failures.push(String(error));
    }
    if (existsSync(result)) {
      const suite: SuiteResult = JSON.parse(readFileSync(result, 'utf8'));
      suites.push(suite);
      if (suite.failed) failures.push(suite.failed);
    } else failures.push(`${script} did not write results; this run is incomplete.`);
  }
  assertPin();
  if (failures.length) metadata.failed = failures.join('\n');
  writeReport(output, metadata, suites);
  console.log(`Combined report: ${relative(repository, resolve(output, 'results.md'))}`);
  if (failures.length) throw new Error(failures.join('\n'));
} catch (error) {
  metadata.failed = String(error);
  writeReport(output, metadata, suites);
  throw error;
} finally {
  for (const server of servers) server.stop(true);
}
