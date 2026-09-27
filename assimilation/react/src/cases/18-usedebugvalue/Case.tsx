import { useDebugValue, useState } from 'react';

function useParity() {
  const [n, setN] = useState(0);
  useDebugValue(n % 2 === 0 ? 'even' : 'odd');
  return [n, setN] as const;
}

export function UseDebugValueCase() {
  const [n, setN] = useParity();
  return (
    <section>
      <h2>useDebugValue — devtools label only</h2>
      <p>
        count: <span data-testid="count">{n}</span>
      </p>
      <button onClick={() => setN((v) => v + 1)}>+1</button>
      <p>
        <small>
          Nothing renders differently — useDebugValue only labels the hook in
          React DevTools. The MMD twin erases it outright.
        </small>
      </p>
    </section>
  );
}
