import { useState, useSyncExternalStore } from 'react';
import { decrement, getSnapshot, increment, subscribe } from './store';

function Reader({ name }: { name: string }) {
  const value = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <button onClick={increment}>
      {name}: {value}
    </button>
  );
}

export function UseSyncExternalStoreCase() {
  const [showB, setShowB] = useState(true);
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
          onChange={(e) => setShowB(e.target.checked)}
        />{' '}
        show B
      </label>
    </section>
  );
}
