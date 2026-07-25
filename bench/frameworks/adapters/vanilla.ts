/**
 * @file vanilla.ts
 * Provides full-view and precisely patched native DOM baselines.
 */
import type { BenchMode, BenchScenario } from '../contract';
import {
  makeSnapshot,
  mutatePlain,
  remaining,
  targetIndex,
  updateImmutable,
  type Snapshot,
} from '../model';

const root = document.querySelector('#app') as HTMLElement;
let snapshot = makeSnapshot(0);
let mode: BenchMode = 'reactive';

function row(todo: Snapshot['todos'][number]): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset.id = String(todo.id);
  item.className = todo.completed ? 'completed' : '';
  item.textContent = todo.title;
  return item;
}

function renderAll(): void {
  const list = document.createElement('ul');
  for (const todo of snapshot.todos) list.append(row(todo));
  const count = document.createElement('strong');
  count.id = 'remaining';
  count.textContent = String(remaining(snapshot));
  root.replaceChildren(list, count);
}

function patchReactive(previous: Snapshot, scenario: BenchScenario): void {
  const list = root.querySelector('ul')!;
  const index = targetIndex(previous);
  const item = list.children[index] as HTMLLIElement | undefined;

  if (scenario === 'rename' && item) {
    item.textContent = snapshot.todos[index]!.title;
  } else if (scenario === 'toggle' && item) {
    item.className = snapshot.todos[index]!.completed ? 'completed' : '';
    root.querySelector('#remaining')!.textContent = String(remaining(snapshot));
  } else if (scenario === 'move' && item && list.children.length > 1) {
    const destination = (index + 1) % list.children.length;
    const reference =
      destination === 0 ? list.children[0] : list.children[index + 2];
    list.insertBefore(item, reference ?? null);
  }
}

window.__frameworkBench = {
  id: 'vanilla',
  label: 'Vanilla DOM',
  version: 'browser',
  reset(count, nextMode) {
    mode = nextMode;
    snapshot = makeSnapshot(count);
    renderAll();
  },
  run(scenario) {
    if (mode === 'forced') {
      mutatePlain(snapshot, scenario);
      renderAll();
      return;
    }
    const previous = snapshot;
    snapshot = updateImmutable(snapshot, scenario);
    patchReactive(previous, scenario);
  },
  validate() {
    return {
      rows: root.querySelectorAll('li').length,
      firstTitle: root.querySelector('li')?.textContent ?? '',
      remaining: Number(root.querySelector('#remaining')?.textContent ?? -1),
    };
  },
};
