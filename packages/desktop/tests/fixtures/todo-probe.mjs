/** Run the independent Vite-built Todo fixture through either engine and Rust. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [directory, executable] = process.argv.slice(2);
const engine = await import(pathToFileURL(join(directory, 'engine.mjs')).href);
const manifest = JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8'));
const css = await readFile(join(directory, 'application.css'), 'utf8');
const host = engine.openApplication(executable, manifest.mountTarget, true);
const records = globalThis.__memoizedTodoPublications;

function operations(from = 0) {
  return records.slice(from).flatMap(record => record.operations);
}

function sourceFor(action, owner = '') {
  const view = host.adapter.view();
  const operation = operations().reverse().find(operation =>
    operation.op === 'setAttribute' && operation.name.local === 'data-action' &&
    operation.value === action && operation.target.owner.id.includes(owner) &&
    view.matchesSource(operation.target),
  );
  assert.ok(operation, `Missing live Todo action: ${action} ${owner}`);
  return operation.target;
}

async function settle() {
  // Drain native acceptance and the existing core scheduler, including updates
  // admitted after earlier rows release a connection credit. This is bounded
  // test bookkeeping, not an application-side publication or mounting API.
  let previous = -1;
  let quiet = 0;

  for (let turn = 0; turn < 60; turn++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await host.adapter.view().publication();
    quiet = records.length === previous ? quiet + 1 : 0;
    previous = records.length;
    if (quiet === 2) return;
  }

  throw new Error('Todo publication did not settle');
}

async function click(action, owner = '') {
  const before = records.length;
  host.adapter.view().dispatch(sourceFor(action, owner), 'onClick', new Event('click'));
  await settle();
  return operations(before);
}

async function typeDraft(value) {
  const view = host.adapter.view();
  const source = sourceFor('draft');
  // This headless publication probe supplies an editor observation. Real edit,
  // cancellation and revision ordering are exercised by the Rust editor tests.
  const target = view.eventTarget(source, { value, revision: 0, isComposing: false });
  view.dispatch(source, 'onInput', { currentTarget: target, target });
  await settle();
}

function hasText(changes, value) {
  return changes.some(operation => operation.op === 'text' && operation.value === value);
}

function mountsText(changes, value) {
  const mounted = new Set(changes.filter(operation => operation.op === 'mount').map(operation => operation.template));
  return records.flatMap(record => record.templates ?? []).some(template =>
    mounted.has(template.key) && template.nodes.some(({ node }) => node.kind === 'text' && node.value === value),
  );
}

try {
  assert.equal(manifest.mountTarget, 'app');
  assert.ok(css.includes('.todo-row'));
  await host.replace([{ source: 'application.css', css, revision: 'todo' }], () =>
    import(pathToFileURL(join(directory, manifest.entry)).href),
  );
  await settle();
  assert.ok(hasText(operations(), '2 tasks left'));

  const retained = sourceFor('local', 'Row[n:1]');
  await click('local', 'Row[n:1]');
  assert.ok(hasText(await click('local', 'Row[n:1]'), 'Clicks 2'));
  const reversed = await click('reverse');
  assert.ok(reversed.some(operation => operation.op === 'moveToEnd' || operation.op === 'moveBefore'));
  assert.equal(reversed.some(operation => operation.op === 'mount' || operation.op === 'retire'), false);
  assert.equal(host.adapter.view().matchesSource(retained), true);
  assert.ok(hasText(await click('local', 'Row[n:1]'), 'Clicks 3'));

  await typeDraft('   ');
  assert.equal((await click('add')).some(operation => operation.op === 'mount'), false);
  await typeDraft('Buy milk');
  const added = await click('add');
  assert.ok(added.some(operation => operation.op === 'mount' && operation.owner.id.includes('Row[n:4]')));
  assert.ok(hasText(added, '3 tasks left'));
  assert.ok(hasText(added, 'Buy milk'));
  assert.ok(added.some(operation => operation.op === 'setValue' && operation.value === ''));
  assert.ok(hasText(await click('toggle', 'Row[n:1]'), '2 tasks left'));
  assert.ok(hasText(await click('rename', 'Row[n:1]'), 'Try the native Todo (edited)'));

  const filtered = await click('completed');
  assert.ok(filtered.some(operation => operation.op === 'setAttribute' && operation.name.local === 'hidden'));
  const restored = await click('all');
  assert.ok(restored.some(operation => operation.op === 'removeAttribute' && operation.name.local === 'hidden'));

  const removed = sourceFor('toggle', 'Row[n:2]');
  await click('remove', 'Row[n:2]');
  assert.equal(host.adapter.view().matchesSource(removed), false);
  const cleared = await click('clear');
  assert.ok(hasText(cleared, '1 tasks in your list'), JSON.stringify(cleared));
  assert.equal(host.adapter.view().matchesSource(retained), false);

  const emptied = await click('remove', 'Row[n:4]');
  assert.ok(hasText(emptied, '0 tasks left'));
  assert.ok(mountsText(emptied, 'A clear list. Add your next small step.'));
  await typeDraft('Write a note');
  const source = sourceFor('draft');
  let cancelled = false;
  host.adapter.view().dispatch(source, 'onKeyDown', {
    key: 'Enter', isComposing: false, preventDefault() { cancelled = true; },
  });
  await settle();
  assert.equal(cancelled, true);
  const beforeReload = sourceFor('toggle', 'Row[n:5]');
  const start = records.length;
  await host.replace([]);
  await settle();
  assert.equal(host.adapter.view().matchesSource(beforeReload), false);
  assert.ok(sourceFor('toggle', 'Row[n:5]').owner.generation > beforeReload.owner.generation);
  assert.ok(hasText(operations(start), '1 tasks left'));
  console.log(JSON.stringify({ todo: true, retainedState: true, mutations: true, reload: true }));
} finally {
  host.close();
  delete globalThis.__memoizedTodoPublications;
}
