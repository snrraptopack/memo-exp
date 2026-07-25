/**
 * @file react.tsx
 * Benchmarks React root reconciliation and idiomatic immutable state updates.
 */
import { memo, useLayoutEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
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
  run(scenario: BenchScenario): void | Promise<void>;
}

let controls: Controls | undefined;
let generation = 0;
let resolveCommit: (() => void) | undefined;

const TodoRow = memo(function TodoRow(props: { todo: Todo; forcedRevision: number }) {
  void props.forcedRevision;
  return <li className={props.todo.completed ? 'completed' : ''}>{props.todo.title}</li>;
});

function App(props: { initial: Snapshot; mode: BenchMode }) {
  const [reactive, setReactive] = useState(props.initial);
  const [forcedRevision, bumpForced] = useReducer((value: number) => value + 1, 0);
  const forced = props.initial;
  const snapshot = props.mode === 'forced' ? forced : reactive;

  useLayoutEffect(() => {
    resolveCommit?.();
    resolveCommit = undefined;
  });

  controls = {
    run(scenario) {
      if (props.mode === 'forced') {
        flushSync(() => {
          mutatePlain(forced, scenario);
          bumpForced();
        });
        return;
      }
      return new Promise<void>((resolve) => {
        resolveCommit = resolve;
        setReactive((current) => updateImmutable(current, scenario));
      });
    },
  };

  const noChange = snapshot.revision ? '' : '';
  return (
    <div>
      <span>{noChange}</span>
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
    </div>
  );
}

const target = document.querySelector('#app') as HTMLElement;
const reactRoot = createRoot(target);

window.__frameworkBench = {
  id: 'react',
  label: 'React',
  version: __FRAMEWORK_VERSION__,
  reset(count, mode) {
    const initial = makeSnapshot(count);
    flushSync(() => {
      reactRoot.render(<App key={++generation} initial={initial} mode={mode} />);
    });
  },
  run(scenario) {
    return controls!.run(scenario);
  },
  validate() {
    return {
      rows: target.querySelectorAll('li').length,
      firstTitle: target.querySelector('li')?.textContent ?? '',
      remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
    };
  },
};
