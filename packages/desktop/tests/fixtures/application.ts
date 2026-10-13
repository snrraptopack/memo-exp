// Run this identical built application under Bun and Node. This is a private
// process contract, not the ordinary mounted TSX example promised by M3.
import assert from 'node:assert/strict';
import { PublicationClient } from '../../src/host/client';
import { connectNativeHost } from '@memoized-dom/desktop/internal-host';

async function run(): Promise<void> {
  const executable = process.argv[2];
  assert(executable, 'Native host path is required');
  const client = new PublicationClient(connectNativeHost({ executable, args: ['--headless'] }));
  try {
    const mount = {
      op: 'mount' as const,
      owner: { id: 'App', generation: 1 },
      template: 'label',
      target: { kind: 'body' as const },
    };
    const refused = await client.publish({ operations: [mount] }).then(
      () => undefined,
      error => error,
    );
    assert.equal(refused?.code, 'unknownTemplate');

    const accepted = await client.publish({
      templates: [{
        key: 'label',
        nodes: [{
          parent: null,
          node: { kind: 'text', value: 'Count: 0' },
        }],
      }],
      operations: [mount],
    });
    assert.equal(accepted.sequence, 1);

    const second = await client.publish({
      operations: [{
        op: 'text',
        target: { owner: { id: 'App', generation: 1 }, source: 0 },
        value: 'Count: 1',
      }],
    });
    assert.equal(second.sequence, 2);
    console.log(JSON.stringify({
      accepted: [accepted.sequence, second.sequence],
      refused: refused.code,
    }));
  } finally {
    client.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
