// Internal acceptance contract, run unchanged under each selected JS engine.
// Application authors will use ordinary TSX/mount(), not these host classes.
import assert from 'node:assert/strict';
import {
  cleanup,
  commit,
  installAccessTable,
  mountRef,
  refAssign,
  registerEffect,
  registerEntity,
  setScheduler,
} from '@memoized-dom/runtime/core';
import { connectNativeHost } from '@memoized-dom/desktop/internal-host';
import { PublicationClient } from '../../src/host/client';
import type { Acceptance } from '../../src/host/protocol';
import { NativeApplication } from '../../src/runtime/application';
import { count, increment, readCount } from './lifecycle-state';

async function run(): Promise<void> {
  const executable = process.argv[2];
  assert(executable, 'Native host path is required');

  const client = new PublicationClient(connectNativeHost({ executable, args: ['--headless'] }));
  const errors: unknown[] = [];
  const application = new NativeApplication(client, {
    scheduleFrame: null,
    visible: () => true,
    reportError: error => errors.push(error),
  });
  application.run(() => setScheduler(() => {}));

  const owner = { id: 'App', generation: 1 };
  const updates: Promise<Acceptance>[] = [];
  const effects: number[] = [];
  let connected = false;
  let assigned = false;
  let refDisposals = 0;
  let effectDisposals = 0;
  let ownedDisposals = 0;
  const target = { get isConnected() { return connected; } };

  try {
    const candidate = application.prepare(() => {
      registerEntity({
        id: owner.id,
        parent: null,
        render() {
          updates.push(application.publishUpdates({ operations: [{
            op: 'text',
            target: { owner, source: 0 },
            value: 'Count: ' + readCount(),
          }] }));
        },
      });
      installAccessTable({ readers: { [count.key]: ['App', 'App/effect'] } }, 'App', 'process-table');

      cleanup('App', () => { ownedDisposals++; });
      cleanup('App', mountRef(target, refAssign(value => {
        assert.equal(value.isConnected, true);
        assigned = true;

        return () => {
          assigned = false;
          refDisposals++;
        };
      })));
      registerEffect('App/effect', 'App', () => {
        assert.equal(assigned, true, 'Refs activate before effects');
        effects.push(readCount());

        return () => { effectDisposals++; };
      });
    }, {
      accepted() { connected = true; },
      disposed() { connected = false; },
    });

    const mounted = candidate.publish({
      templates: [{
        key: 'counter',
        nodes: [{ parent: null, node: { kind: 'text', value: 'Count: 0' } }],
      }],
      operations: [{ op: 'mount', owner, template: 'counter', target: { kind: 'body' } }],
    });
    application.run(commit);
    assert.equal(assigned, false);
    assert.deepEqual(effects, []);

    assert.equal((await mounted).sequence, 1);
    application.run(commit);
    assert.deepEqual(effects, [0]);

    // An imported helper invalidates through the same core access table.
    // Its effect must wait until the Rust text operation is accepted.
    application.run(() => {
      increment();
      commit();
    });
    assert.deepEqual(effects, [0]);
    assert.equal(updates.length, 1);
    assert.equal((await updates[0]!).sequence, 2);
    assert.deepEqual(effects, [0, 1]);

    const refused = await candidate.retire({ operations: [{
      op: 'retire', owner: { id: 'Missing', generation: 1 },
    }] }).then(() => undefined, error => error);
    assert.equal(refused?.code, 'documentRefused');
    assert.equal(candidate.status, 'active');
    assert.equal(assigned, true);
    assert.equal(refDisposals, 0);

    const retired = await candidate.retire({ operations: [{ op: 'retire', owner }] });
    assert.equal(retired.sequence, 3);
    assert.equal(assigned, false);
    assert.equal(connected, false);
    assert.equal(application.runtime.state.registry.size, 0);
    application.close();
    assert.deepEqual(errors, []);

    console.log(JSON.stringify({
      accepted: [1, 2, 3],
      effects,
      refDisposals,
      effectDisposals,
      ownedDisposals,
      refused: refused.code,
    }));
  } finally {
    application.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
