/**
 * @file solid.tsx
 * Benchmarks idiomatic Solid stores and a bounded forced-refresh signal.
 */
import { batch, createMemo, createSignal, For } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';
import type { BenchMode, BenchScenario } from '../contract';
import {
  makeSnapshot,
  mutatePlain,
  remaining,
  type Snapshot,
  type Todo,
} from '../model';

declare const __FRAMEWORK_VERSION__: string;

const [mode, setMode] = createSignal<BenchMode>('reactive');
const [reactiveSnapshot, setReactiveSnapshot] = createStore(makeSnapshot(0));
const [forcedRevision, setForcedRevision] = createSignal(0);
let forcedSnapshot = makeSnapshot(0);

function visible(): Snapshot {
  if (mode() === 'forced') void forcedRevision();
  return (mode() === 'forced' ? forcedSnapshot : reactiveSnapshot) as Snapshot;
}

function TodoRow(props: { todo: Todo }) {
  const title = () => {
    if (mode() === 'forced') void forcedRevision();
    return props.todo.title;
  };
  const completed = () => {
    if (mode() === 'forced') void forcedRevision();
    return props.todo.completed;
  };
  return (
    <li classList={{ completed: completed() }} data-id={String(props.todo.id)}>
      {title()}
    </li>
  );
}

const remainingCount = createMemo(() => remaining(visible()));

function App() {
  return (
    <>
      <span>{visible().revision ? '' : ''}</span>
      <ul>
        <For each={visible().todos}>{(todo) => <TodoRow todo={todo} />}</For>
      </ul>
      <strong id="remaining">{remainingCount()}</strong>
    </>
  );
}

const target = document.querySelector('#app') as HTMLElement;
render(App, target);

window.__frameworkBench = {
  id: 'solid',
  label: 'Solid',
  version: __FRAMEWORK_VERSION__,
  reset(count, nextMode) {
    batch(() => {
      setMode(nextMode);
      forcedSnapshot = makeSnapshot(count);
      setReactiveSnapshot(reconcile(makeSnapshot(count)));
      setForcedRevision((value) => value + 1);
    });
  },
  run(scenario) {
    batch(() => {
      if (mode() === 'forced') {
        mutatePlain(forcedSnapshot, scenario);
        setForcedRevision((value) => value + 1);
      } else {
        setReactiveSnapshot(produce((snapshot) => mutatePlain(snapshot as Snapshot, scenario)));
      }
    });
  },
  validate() {
    return {
      rows: target.querySelectorAll('li').length,
      firstTitle: target.querySelector('li')?.textContent?.trim() ?? '',
      order: Array.from(target.querySelectorAll('li'), (row) => row.dataset.id).join(','),
      remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
      state: Array.from(target.querySelectorAll('li'), (row) => `${row.dataset.id}:${row.classList.contains('completed') ? 1 : 0}:${row.textContent?.trim() ?? ''}`).join('|'),
    };
  },
};
