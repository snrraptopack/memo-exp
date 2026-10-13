import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { executionCommand, type RuntimeSelection } from '../src/dev/execution';
import { bundleExecutionEntry } from '../src/dev/bundle';
import { PublicationClient } from '../src/host/client';
import { connectNativeHost } from '../src/host/node-process';
import { sourceTemplate } from './fixtures/native-template';

const nativeHost = process.env.MEMOIZED_DESKTOP_HOST ?? fileURLToPath(new URL(
  '../rust/target/debug/memoized-dom-desktop' + (process.platform === 'win32' ? '.exe' : ''),
  import.meta.url,
));
let directory: string;

beforeAll(async () => {
  try { await access(nativeHost); } catch {
    throw new Error('Build the native host with cargo +1.96.0 build first, or set MEMOIZED_DESKTOP_HOST');
  }
  directory = await mkdtemp(join(tmpdir(), 'memoized-dom-engine-contract-'));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const customBackend = {
  name: 'custom-node-adapter',
  command: ['node'] as const,
  moduleFormat: 'cjs' as const,
  bundleTarget: 'node' as const,
  hostAdapter: fileURLToPath(new URL('./fixtures/custom-adapter.ts', import.meta.url)),
};

for (const runtime of ['bun', 'node', customBackend] satisfies RuntimeSelection[]) {
  const name = typeof runtime === 'string' ? runtime : runtime.name;
  for (const fixture of ['application', 'lifecycle']) {
    test(name + ' runs ' + fixture + ' against the real native host', async () => {
      const probe = join(directory, name + '-' + fixture + '.probe');
      const { entry } = await bundleExecutionEntry({
        entry: fileURLToPath(new URL('./fixtures/' + fixture + '.ts', import.meta.url)),
        outfile: join(directory, name + '-' + fixture + (typeof runtime === 'string' ? '.mjs' : '.cjs')),
        runtime,
      });
      const [command, ...args] = executionCommand(entry, runtime, [nativeHost]);
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, MEMOIZED_CUSTOM_ADAPTER_PROBE: probe },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Engine contract timed out')); }, 15_000);
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      });
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(fixture === 'application'
        ? { accepted: [1, 2], refused: 'unknownTemplate' }
        : {
            accepted: [1, 2, 3], effects: [0, 1], refDisposals: 1,
            effectDisposals: 2, ownedDisposals: 1, refused: 'documentRefused',
          });
      if (typeof runtime !== 'string') {
        expect(await readFile(probe, 'utf8')).toBe('custom adapter selected');
      }
    }, 20_000);
  }
}

test('missing native executable rejects pending work without hanging', async () => {
  const client = new PublicationClient(connectNativeHost({ executable: join(directory, 'does-not-exist') }));
  const active = client.publish({ operations: [] }).then(() => undefined, error => error);
  const queued = client.publish({ operations: [] }).then(() => undefined, error => error);
  expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
  expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
  expect(client.isClosed).toBe(true);
});

test('packaged compiler templates address real native text, regions and retired generations', async () => {
  const parent = sourceTemplate(`
    export function App({children}){let count=0;
      return <main><p>Count: {count}</p><section>{children}<small>End</small></section></main>
    }
  `, 'compiled-parent', ['children']).plan;
  const row = sourceTemplate('export function App(){return <span>Row</span>}', 'compiled-row').plan;
  const text = parent.steps.find(step => step.kind === 'text')!;
  const region = parent.steps.find(step => step.kind === 'region')!;
  const parentOwner = { id: 'Parent', generation: 1 };
  const rowOwner = { id: 'Row', generation: 1 };
  const client = new PublicationClient(connectNativeHost({ executable: nativeHost, args: ['--headless'] }));

  try {
    const mounted = await client.publish({
      templates: [parent.template, row.template],
      operations: [
        { op: 'mount', owner: parentOwner, template: parent.template.key, target: { kind: 'body' } },
        { op: 'text', target: { owner: parentOwner, source: text.source }, value: 'Count: 0' },
        {
          op: 'mount', owner: rowOwner, template: row.template.key,
          target: { kind: 'region', source: { owner: parentOwner, source: region.source } },
        },
      ],
    });
    expect(mounted.sequence).toBe(1);

    const updated = await client.publish({ operations: [
      { op: 'text', target: { owner: parentOwner, source: text.source }, value: 'Count: 1' },
      { op: 'text', target: { owner: rowOwner, source: 1 }, value: 'Updated row' },
    ] });
    expect(updated.sequence).toBe(2);

    const retired = await client.publish({ operations: [{ op: 'retire', owner: parentOwner }] });
    expect(retired.sequence).toBe(3);
    const stale = await client.publish({ operations: [{
      op: 'text', target: { owner: rowOwner, source: 1 }, value: 'Stale',
    }] }).then(() => undefined, error => error);
    expect(stale).toMatchObject({ code: 'documentRefused', reply: { expectedSequence: 4 } });

    // Template records are reusable; source handles remain generation-specific.
    const remounted = await client.publish({ operations: [{
      op: 'mount', owner: { id: 'Parent', generation: 2 }, template: parent.template.key,
      target: { kind: 'body' },
    }] });
    expect(remounted.sequence).toBe(4);
    expect(client.isClosed).toBe(false);
  } finally {
    client.close();
  }
});

test('native exit fails all active and queued jobs without replay', async () => {
  // The same real executable refuses startup without --headless, closing its
  // stream before any publication can be accepted.
  const client = new PublicationClient(connectNativeHost({ executable: nativeHost }));
  const active = client.publish({ operations: [] }).then(() => undefined, error => error);
  const queued = client.publish({ operations: [] }).then(() => undefined, error => error);
  expect(await active).toMatchObject({ code: 'acceptanceUnknown' });
  expect(await queued).toMatchObject({ code: 'acceptanceUnknown' });
  expect(client.isClosed).toBe(true);
});

test('the process adapter bounds direct writes without corrupting the native stream', async () => {
  const transport = connectNativeHost({ executable: nativeHost, args: ['--headless'] });
  const received: unknown[] = [];
  let expectedReplies = 0;
  let receive!: () => void;
  let fail!: (error: Error) => void;
  const accepted = new Promise<void>((resolve, reject) => {
    receive = resolve;
    fail = reject;
  });
  transport.listen({
    reply(value) {
      received.push(value);
      if (expectedReplies !== 0 && received.length >= expectedReplies) receive();
    },
    failure(error) { fail(error); },
  });
  try {
    const first = transport.send(JSON.stringify({ version: 1, sequence: 1, operations: [] }));
    const second = transport.send(JSON.stringify({ version: 1, sequence: 2, operations: [] }));
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0]!.status).toBe('fulfilled');
    const next = outcomes[1]!;
    // Bun may finish a small write synchronously. If it has, the second frame
    // is safe to send; otherwise the adapter refuses another outstanding write.
    if (next.status === 'rejected') {
      expect(next.reason).toMatchObject({ code: 'writeInProgress' });
      expectedReplies = 1;
    } else {
      expectedReplies = 2;
    }
    if (received.length >= expectedReplies) receive();
    await accepted;
    expect(received).toEqual(Array.from({ length: expectedReplies }, (_value, index) => ({
      version: 1, status: 'accepted', sequence: index + 1,
    })));
  } finally {
    transport.dispose();
  }
});
