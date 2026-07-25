/**
 * @file preact.tsx
 * Benchmarks Preact component refreshes and immutable hook state updates.
 */
import { render } from 'preact';
import { memo } from 'preact/compat';
import { useReducer, useState } from 'preact/hooks';
import type { BenchMode, BenchScenario } from '../contract';
import {
  makeSnapshot,
  mutatePlain,
  remaining,
  updateImmutable,
  type Snapshot,
  type Todo,
} from '../model';

declare const __FRAMEWORK_VERSION__: string;

interface Controls {
  run(scenario: BenchScenario): void;
}

let controls: Controls | undefined;
let generation = 0;

const TodoRow = memo(function TodoRow(props: { todo: Todo; forcedRevision: number }) {
  void props.forcedRevision;
  return <li class={props.todo.completed ? 'completed' : ''}>{props.todo.title}</li>;
});

function App(props: { initial: Snapshot; mode: BenchMode }) {
  const [reactive, setReactive] = useState(props.initial);
  const [forcedRevision, bumpForced] = useReducer((value: number) => value + 1, 0);
  const snapshot = props.mode === 'forced' ? props.initial : reactive;

  controls = {
    run(scenario) {
      if (props.mode === 'forced') {
        mutatePlain(props.initial, scenario);
        bumpForced();
      } else {
        setReactive((current) => updateImmutable(current, scenario));
      }
    },
  };

  return (
    <>
      <span>{snapshot.revision ? '' : ''}</span>
      <ul>
        {snapshot.todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            forcedRevision={props.mode === 'forced' ? forcedRevision : 0}
          />
        ))}
      </ul>
      <strong id="remaining">{remaining(snapshot)}</strong>
    </>
  );
}

const target = document.querySelector('#app') as HTMLElement;

window.__frameworkBench = {
  id: 'preact',
  label: 'Preact',
  version: __FRAMEWORK_VERSION__,
  async reset(count, mode) {
    render(<App key={++generation} initial={makeSnapshot(count)} mode={mode} />, target);
    await Promise.resolve();
  },
  async run(scenario) {
    controls!.run(scenario);
    await Promise.resolve();
  },
  validate() {
    return {
      rows: target.querySelectorAll('li').length,
      firstTitle: target.querySelector('li')?.textContent?.trim() ?? '',
      remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
    };
  },
};
