import { decrement, getSnapshot, increment, subscribe } from './store';

function Reader({ name }: { name: string }) {
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

export function UseSyncExternalStoreCase() {
  let showB = true;
  return (
    <section>
      <h2>useSyncExternalStore — external store</h2>
      <p>
        <Reader name="A" /> {showB ? <Reader name="B" /> : null}
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
