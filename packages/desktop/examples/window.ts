/** Build-side launcher shared by ordinary mounted examples. */
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { buildDesktopEngine, buildDesktopRunner, desktopApplicationConfig } from '../src/dev/vite';
import { executionCommand } from '../src/dev/execution';

const example = process.argv[2] ?? 'counter';
if (example !== 'counter' && example !== 'dashboard' && example !== 'todo') {
  throw new Error('Choose the counter, dashboard or todo example');
}
const root = fileURLToPath(new URL(`./${example}`, import.meta.url));
const outDir = resolve(root, `../../../../.cache/blitz-${example}`);
const executable = process.env.MEMOIZED_DESKTOP_HOST ?? fileURLToPath(new URL(
  '../rust/target/debug/memoized-dom-desktop' + (process.platform === 'win32' ? '.exe' : ''),
  import.meta.url,
));
const runtime = process.env.MEMOIZED_DESKTOP_RUNTIME ?? 'bun';
if (runtime !== 'bun' && runtime !== 'node') {
  throw new Error('This example launcher selects bun or node through MEMOIZED_DESKTOP_RUNTIME');
}
const capabilities = spawnSync(executable, ['--capabilities'], { encoding: 'utf8', windowsHide: true });
if (capabilities.status !== 0 || !JSON.parse(capabilities.stdout || '{}').window) {
  throw new Error('Build the graphical host once with bun run desktop:build:native before desktop:dev');
}
const options = { root, entry: 'main.ts', outDir, runtime } as const;
const started = performance.now();
const backend = await buildDesktopEngine(options);
console.log(`Pinned execution module built in ${(performance.now() - started).toFixed(0)}ms; no Cargo invocation`);

// Runner bookkeeping is bundled by Vite too. Node never needs to execute TS.
await buildDesktopRunner(options);

const watcher = await build(desktopApplicationConfig(options, true));
if (!('on' in watcher)) throw new Error('Vite did not return a build watcher');
let child: ReturnType<typeof spawn> | undefined;
watcher.on('event', event => {
  if (event.code === 'ERROR') console.error(event.error);
  if (event.code !== 'END') return;
  if (child) {
    child.stdin?.write('reload\n');
    return;
  }
  const [command, ...arguments_] = executionCommand(resolve(outDir, 'runner.mjs'), backend, [outDir, executable]);
  child = spawn(command, arguments_, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  child.on('error', error => {
    console.error(error);
    void watcher.close();
    process.exitCode = 1;
  });
  child.on('exit', code => {
    void watcher.close();
    process.exitCode = code ?? 1;
  });
});
process.on('SIGINT', () => {
  child?.stdin?.end();
  void watcher.close();
});
