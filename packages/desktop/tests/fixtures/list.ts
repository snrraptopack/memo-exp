/** Private native ABI fixture; application authoring remains ordinary TSX. */
import assert from 'node:assert/strict';
import { commit, setScheduler } from '@memoized-dom/runtime/core';
import { NativeApplication } from '../../src/runtime/application';
import { createList, type NativeList } from '../../src/runtime/list';
import { NativeView, child, type NativeFrame } from '../../src/runtime/view';
import { PublicationClient } from '../../src/host/client';
import { connectNativeHost } from '@memoized-dom/desktop/internal-host';
import type { SourceReference } from '../../src/host/protocol';

interface Item {
  readonly id: string;
  readonly label: string;
}

async function run() {
  const transport = connectNativeHost({ executable: process.argv[2]!, args: ['--headless'] });
  let injectRefusal = true;
  const errors: unknown[] = [];
  // Append one invalid operation to the first structural change. Rust must
  // refuse its preceding retire/mount/move operations without applying them.
  const client = new PublicationClient({
    send(json) {
      const request = JSON.parse(json);

      if (injectRefusal && request.sequence === 2) {
        injectRefusal = false;
        request.operations.push({
          op: 'text',
          target: { owner: { id: 'Missing', generation: 1 }, source: 0 },
          value: 'Invalid',
        });
        return transport.send(JSON.stringify(request));
      }

      return transport.send(json);
    },
    listen: observer => transport.listen(observer),
    scheduleDeadline: (duration, callback) => transport.scheduleDeadline(duration, callback),
    dispose: () => transport.dispose(),
  });
  const application = new NativeApplication(client, {
    scheduleFrame: null,
    visible: () => true,
    reportError: error => errors.push(error),
  });
  application.run(() => setScheduler(() => {}));
  let items: readonly Item[] = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }];
  const created: Array<{ key: string; frame: NativeFrame; view: NativeView }> = [];
  const clicks: string[] = [];
  let list!: NativeList<Item>;
  let view!: NativeView;

  try {
    const candidate = application.prepare(() => {
      view = new NativeView({
        application,
        owner: { id: 'App', generation: 1 },
        parent: null,
        reportError: error => errors.push(error),
      }, {
        key: 'list-parent',
        nodes: [
          { parent: null, node: {
            kind: 'element',
            name: { namespace: 'http://www.w3.org/1999/xhtml', local: 'ul' },
            attributes: [],
          } },
          { parent: 0, node: { kind: 'comment', value: 'rows' } },
        ],
      }, () => [], [child('List', 1, frame => {
        list = createList(frame, () => items, (rowFrame, firstItem, firstIndex) => {
          let item = firstItem;
          let index = firstIndex;
          let localClicks = 0;
          const onClick = () => {
            clicks.push(`${item.label}:${index}:${++localClicks}`);
          };
          const row = new NativeView(rowFrame, {
            key: 'native-list-row',
            nodes: [
              { parent: null, node: {
                kind: 'element',
                name: { namespace: 'http://www.w3.org/1999/xhtml', local: 'li' },
                attributes: [],
              } },
              { parent: 0, node: { kind: 'text', value: '' } },
              { parent: 0, node: { kind: 'comment', value: 'detail' } },
            ],
          }, () => [
            { kind: 'text', source: 1, value: item.label },
            { kind: 'attributes', source: 0, value: { onClick } },
          ], [child('Detail', 2, detailFrame => new NativeView(detailFrame, {
            key: 'native-list-detail',
            nodes: [{ parent: null, node: { kind: 'text', value: ' Detail' } }],
          }, () => []))]);
          created.push({ key: item.id, frame: rowFrame, view: row });

          return {
            view: row,
            update(nextItem, nextIndex) { item = nextItem; index = nextIndex; },
          };
        }, item => item.id);

        return list;
      })]);

      return view;
    }, {
      accepted() { view.acceptInitial(); },
      activated() { view.activateUpdates(); },
    });
    const source = (key: string): SourceReference => ({
      owner: [...created].reverse().find(row => row.key === key)!.frame.owner, source: 0,
    });
    const render = () => application.run(() => { list.updateFromOwner(); commit(); });
    const accepted: number[] = [];
    accepted.push((await candidate.publish(view.initialPublication)).sequence);
    const alpha = source('a');
    const registry = [...application.runtime.state.registry.keys()];
    view.dispatch(alpha, 'onClick', new Event('click'));

    items = [{ id: 'b', label: 'Changed' }, { id: 'c', label: 'Staged' }];
    render();
    const refused = await list.publication().then(() => null, error => error);
    assert.equal(refused.code, 'documentRefused');
    assert.deepEqual([...application.runtime.state.registry.keys()], registry);
    assert.equal(list.matchesSource(source('c')), false);
    assert.throws(() => created[2]!.view.attachCore(), /disposed/);

    // Corrected order moves the original Alpha range and its nested Detail.
    items = [{ id: 'b', label: 'Beta' }, { id: 'a', label: 'Alpha' }];
    render();
    accepted.push((await list.publication())!.sequence);
    application.run(commit);
    await list.publication();
    view.dispatch(alpha, 'onClick', new Event('click'));
    assert.deepEqual(clicks, ['Alpha:0:1', 'Alpha:1:2']);
    assert.equal(created.length, 3);

    items = [{ id: 'b', label: 'Beta' }];
    render();
    accepted.push((await list.publication())!.sequence);
    application.run(commit);
    await list.publication();
    assert.equal(application.runtime.state.registry.has(alpha.owner.id + '/Detail'), false);
    assert.equal(view.matchesSource(alpha), false);

    items = [{ id: 'b', label: 'Beta' }, { id: 'a', label: 'Again' }];
    render();
    accepted.push((await list.publication())!.sequence);
    application.run(commit);
    await list.publication();
    const replacement = source('a');
    assert.equal(replacement.owner.id, alpha.owner.id);
    assert.ok(replacement.owner.generation > alpha.owner.generation);
    assert.equal(view.matchesSource(alpha), false);
    view.dispatch(replacement, 'onClick', new Event('click'));
    assert.equal(clicks.at(-1), 'Again:1:1');

    accepted.push((await candidate.retire(view.retirementPublication())).sequence);
    assert.equal(application.runtime.state.registry.size, 0);
    assert.equal(errors.length, 1);
    console.log(JSON.stringify({ accepted, refused: refused.code, list: true }));
  } finally {
    application.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
