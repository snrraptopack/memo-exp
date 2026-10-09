import { expect, it } from 'bun:test';
import { createProcessHost, type DesktopProcessOptions } from '../src/bridge/process';

// Keep generated literals out of Windows command-line quote parsing.
const child = (script: string, options: Partial<DesktopProcessOptions> = {}) => createProcessHost({ executable: process.execPath,
  args: ['-e', `await import('data:text/javascript;base64,${Buffer.from(script).toString('base64')}');`], window: true, ...options });
const receive = `import {createInterface} from 'node:readline';
  const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
  console.log(JSON.stringify({type:'ready'}));`;

// Settle subprocess I/O before asserting a rejection in the current Bun runner.
async function rejection(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(() => { throw new Error('Expected host rejection'); }, error => error as Error);
  expect(error).toBeInstanceOf(Error);
  return error;
}

it('shares one shutdown across concurrent callers and rejects new work during shutdown', async () => {
  const host = child(`${receive}
    let shutdowns=0;
    for await(const line of lines) {
      const request=JSON.parse(line);
      if(request.kind!=='shutdown') process.exit(3);
      if(++shutdowns!==1) process.exit(4);
      await Bun.sleep(30);
      console.log(JSON.stringify({id:request.id,result:null}));
    }
  `);
  await host.ready;
  const closing = host.close();
  const second = host.close();
  const late = host.inspect();
  expect((await rejection(late)).message).toContain('closing');
  await Promise.all([closing, second]);
  await host.close();
});

it('rejects outstanding requests and later work when the host crashes', async () => {
  const host = child(`${receive}
    for await(const line of lines) {
      console.error('native host crashed'); process.exit(7);
    }
  `);
  await host.ready;
  const first = host.inspect().catch(error => error as Error);
  const second = host.redraw().catch(error => error as Error);
  const errors = await Promise.all([first, second]);
  for (const error of errors) expect((error as Error).message).toContain('native host crashed');
  expect((await rejection(host.inspect())).message).toContain('exited (7)');
  expect((await rejection(host.close())).message).toContain('exited (7)');
});

for (const response of [null, [], { id: 1 }, { id: 1, result: null, error: 'ambiguous' }, { id: 1, error: 7 }, { id: 1, type: 'unknown', result: null }]) {
  it(`fails malformed response envelopes without leaving pending requests: ${JSON.stringify(response)}`, async () => {
    const host = child(`${receive}
      await Bun.sleep(30);
      console.log(Buffer.from('${Buffer.from(JSON.stringify(response)).toString('base64')}','base64').toString());
      await new Promise(()=>{});
    `);
    await host.ready;
    try {
      expect((await rejection(host.inspect())).message).toContain('Invalid desktop host response');
      expect((await rejection(host.redraw())).message).toContain('Invalid desktop host response');
    } finally { expect((await rejection(host.close())).message).toContain('Invalid desktop host response'); }
  });
}

it('keeps an explicit native rejection recoverable on the same connection', async () => {
  const host = child(`${receive}
    for await(const line of lines) {
      const request=JSON.parse(line);
      if(request.kind==='apply') console.log(JSON.stringify({id:request.id,error:'rejected transaction'}));
      else console.log(JSON.stringify({id:request.id,result:request.kind==='inspect'?{sequence:0,instances:[]}:null}));
      if(request.kind==='shutdown') break;
    }
  `);
  await host.ready;
  try {
    expect((await rejection(host.commit({sequence:1,operations:[]}))).message).toContain('rejected transaction');
    expect(await host.inspect()).toEqual({sequence:0,instances:[]});
  } finally { await host.close(); }
});

it('bounds retained native diagnostics while preserving the end of a crash report', async () => {
  const host = child(`${receive}
    for await(const line of lines) {
      process.stderr.write('x'.repeat(100_000)+'\\nfinal crash diagnostic\\n'); process.exit(8);
    }
  `);
  await host.ready;
  const error = await host.inspect().catch(error => error as Error);
  expect((error as Error).message).toContain('final crash diagnostic');
  expect((error as Error).message.length).toBeLessThan(17_000);
  expect((await rejection(host.close())).message).toContain('final crash diagnostic');
});

it('retires a host that never announces readiness', async () => {
  const host = child('setInterval(()=>{},1000);', { startupTimeoutMs: 500 });
  expect((await rejection(host.ready)).message).toContain('timed out during startup');
  await host.windowClosed;
  expect((await rejection(host.close())).message).toContain('timed out during startup');
});

it('retires all requests after a lost response and never retries ambiguous publication', async () => {
  const host = child(`${receive} for await(const line of lines) {}`, { requestTimeoutMs: 500 });
  await host.ready;
  const publication = rejection(host.commit({ sequence: 1, operations: [] }));
  const inspection = rejection(host.inspect());
  const errors = await Promise.all([publication, inspection]);
  expect(errors.map(error => error.message)).toEqual(['Desktop host timed out during apply', 'Desktop host timed out during apply']);
  expect((await rejection(host.commit({ sequence: 1, operations: [] }))).message).toContain('timed out during apply');
  expect((await rejection(host.close())).message).toContain('timed out during apply');
});

it('bounds shutdown even when it is acknowledged but the process never exits', async () => {
  const host = child(`${receive}
    for await(const line of lines) {
      const request=JSON.parse(line);
      console.log(JSON.stringify({id:request.id,result:null}));
      setInterval(()=>{},1000); break;
    }
  `, { shutdownTimeoutMs: 500 });
  await host.ready;
  const first = rejection(host.close()); const second = rejection(host.close());
  expect((await first).message).toContain('timed out during shutdown');
  expect((await second).message).toContain('timed out during shutdown');
});

it('settles readiness when a host is closed before startup completes', async () => {
  const host = child(`import {createInterface} from 'node:readline';
    for await(const line of createInterface({input:process.stdin})) {
      const request=JSON.parse(line); console.log(JSON.stringify({id:request.id,result:null})); break;
    }
  `);
  const ready = rejection(host.ready);
  await host.close();
  expect((await ready).message).toContain('closed before ready');
});

it('validates deadline configuration before spawning a process', () => {
  for (const value of [-1, 1.5, Infinity, NaN, 2_147_483_648]) {
    expect(() => createProcessHost({ executable: 'must-not-be-spawned', requestTimeoutMs: value })).toThrow('nonnegative timer duration');
  }
});
