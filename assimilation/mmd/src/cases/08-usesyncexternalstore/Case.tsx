import {
  current,
  decrement,
  getSnapshot,
  increment,
  subscribe,
} from './store';

function LoweredReader({ name }: { name: string }) {
  let value = getSnapshot();
  effect(() => {
    const onChange = () => {
      const next = getSnapshot();
      if (!Object.is(value, next)) value = next;
    };
    const unsubscribe = subscribe(onChange);
    onChange();
    return unsubscribe;
  });
  return (
    <button onClick={increment}>
      {name}: {value}
    </button>
  );
}

function Lowered() {
  let showB = true;
  return (
    <section>
      <h3>lowered — what compiled React emits</h3>
      <p>
        <LoweredReader name="A" /> {showB ? <LoweredReader name="B" /> : null}
      </p>
      <button onClick={decrement}>store -1</button>
      <label>
        <input
          type="checkbox"
          checked={showB}
          onChange={(e) => (showB = e.currentTarget.checked)}
        />{' '}
        show B
      </label>
    </section>
  );
}

function IdiomaticReader({ name }: { name: string }) {
  return (
    <button onClick={increment}>
      {name}: {current}
    </button>
  );
}

function Idiomatic() {
  return (
    <section>
      <h3>idiomatic — module state read directly</h3>
      <p>
        <IdiomaticReader name="A" /> <IdiomaticReader name="B" />
      </p>
      <p>
        <small>
          No subscribe/effect — `current` is a module `let`; reads in JSX are
          already reactive.
        </small>
      </p>
    </section>
  );
}

export function UseSyncExternalStoreCase() {
  return (
    <>
      <h2>useSyncExternalStore — lowered vs idiomatic</h2>
      <Lowered />
      <Idiomatic />
    </>
  );
}
