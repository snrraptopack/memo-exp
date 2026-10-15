/** Test-owned Todo fixture, normal Vite CSS/mount, both JS engines and real native acceptance. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { buildDesktopEngine, desktopApplicationConfig } from '../src/dev/vite';

const root = fileURLToPath(new URL('./fixtures/todo', import.meta.url));
const native = process.env.MEMOIZED_DESKTOP_HOST ?? fileURLToPath(new URL(
  '../rust/target/debug/memoized-dom-desktop' + (process.platform === 'win32' ? '.exe' : ''),
  import.meta.url,
));
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memoized-todo-native-'));
  const adapter = join(directory, 'recording-adapter.ts');
  const processAdapter = fileURLToPath(new URL('../src/host/node-process.ts', import.meta.url));

  // Observe the existing transport; do not replace acceptance or native state
  // with a second document model. The application source stays untouched.
  await writeFile(adapter, `
    import { connectNativeHost as connect } from ${JSON.stringify(processAdapter.replaceAll('\\', '/'))};
    globalThis.__memoizedTodoPublications = [];
    export function connectNativeHost(options) {
      const transport = connect(options);
      return {
        send(json) {
          globalThis.__memoizedTodoPublications.push(JSON.parse(json));
          return transport.send(json);
        },
        listen: observer => transport.listen(observer),
        scheduleDeadline: (milliseconds, callback) => transport.scheduleDeadline(milliseconds, callback),
        dispose: () => transport.dispose(),
      };
    }
  `);
  const options = {
    root,
    entry: 'main.ts',
    outDir: directory,
    runtime: {
      name: 'recording-node-compatible',
      command: ['node'] as const,
      moduleFormat: 'esm' as const,
      bundleTarget: 'node' as const,
      hostAdapter: adapter,
    },
    vite: { logLevel: 'silent' as const },
  };
  await buildDesktopEngine(options);
  await build(desktopApplicationConfig(options));
  await writeFile(join(directory, 'probe.mjs'), await readFile(new URL('./fixtures/todo-probe.mjs', import.meta.url)));
}, 60_000);

afterAll(async () => {
  if (!directory) return;
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('memoized-todo-native-')) {
    throw new Error('Refusing to remove an unexpected Todo test directory');
  }
  await rm(target, { recursive: true, force: true });
});

for (const runtime of ['bun', 'node']) {
  test(`${runtime} runs test-owned cross-module Todo mutations against Rust`, async () => {
    const child = Bun.spawn([runtime, join(directory, 'probe.mjs'), directory, native], {
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });

    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ todo: true, retainedState: true, mutations: true, reload: true });
    } finally {
      child.kill();
    }
  }, 30_000);
}
