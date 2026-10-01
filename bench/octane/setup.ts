import { assertPin, repository, upstream } from './pin';
import { command, pnpm } from './process';

await command('git', ['-c', 'core.longpaths=true', 'submodule', 'update', '--init', '--depth', '1',
  '--', 'bench/octane/upstream'], repository);
await command('git', ['config', 'core.longpaths', 'true'], upstream);
await command('git', ['sparse-checkout', 'set', 'packages/octane',
  'benchmarks/js-framework', 'benchmarks/lib', 'patches'], upstream);
assertPin();
// Install the source compiler first, then the benchmark workspace, using the
// upstream frozen lockfile for both stages.
await pnpm(['--filter', 'octane', 'install', '--prod', '--frozen-lockfile', '--ignore-scripts']);
await pnpm(['--filter', 'octane-js-framework-benchmarks', '--filter', '*-jsbench',
  'install', '--frozen-lockfile', '--ignore-scripts']);
await pnpm(['--filter', 'octane-js-framework-benchmarks', 'exec', 'playwright', 'install', 'chromium']);
assertPin();
console.log('Pinned Octane benchmark dependencies and Chromium are ready.');
