/**
 * @file memoized.tsx
 * Authors the memoized-dom comparison entirely in compiler-owned TSX.
 */
import type { BenchMode, BenchScenario } from '../contract';
import {
  makeSnapshot,
  mutatePlain,
  remaining,
  updateImmutable,
  type Snapshot,
  type Todo,
} from '../model';

const store: { snapshot: Snapshot } = { snapshot: makeSnapshot(0) };
let mode: BenchMode = 'reactive';
let forcedRevision = 0;

interface MemoizedControls {
  reset(count: number, mode: BenchMode): void;
  run(scenario: BenchScenario): void;
}

export let memoizedControls: MemoizedControls;

function publishMemoizedControls(
  reset: MemoizedControls['reset'],
  run: MemoizedControls['run'],
): void {
  memoizedControls = { reset, run };
}

function MemoizedRow(props: { todo: Todo; forcedRevision: number }) {
  return (
    <li class={props.todo.completed ? 'completed' : ''}>
      {props.forcedRevision ? props.todo.title : props.todo.title}
    </li>
  );
}

export function MemoizedApp() {
  const reset = (count: number, nextMode: BenchMode): void => {
    store.snapshot = makeSnapshot(count);
    mode = nextMode;
    forcedRevision++;
  };
  const run = (scenario: BenchScenario): void => {
    if (mode === 'forced') {
      mutatePlain(store.snapshot, scenario);
      forcedRevision++;
    } else {
      store.snapshot = updateImmutable(store.snapshot, scenario);
    }
  };
  publishMemoizedControls(reset, run);

  return (
    <div>
      <span>{store.snapshot.revision ? '' : ''}</span>
      <ul>
        {store.snapshot.todos.map((todo) => (
          <MemoizedRow
            key={todo.id}
            todo={todo}
            forcedRevision={mode === 'forced' ? forcedRevision : 0}
          />
        ))}
      </ul>
      <strong id="remaining">{remaining(store.snapshot)}</strong>
    </div>
  );
}
