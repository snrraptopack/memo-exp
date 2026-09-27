import { useState } from 'react';

export function UseStateCounter() {
  const [count, setCount] = useState(0);
  const doubled = count * 2;

  return (
    <section>
      <h2>useState counter</h2>
      <p>
        count: <span data-testid="count">{count}</span>
      </p>
      <p>
        doubled: <span data-testid="doubled">{doubled}</span>
      </p>
      <button onClick={() => setCount((c) => c + 1)}>+1</button>
      <button onClick={() => setCount((c) => c - 1)}>-1</button>
      <button onClick={() => setCount(0)}>reset</button>
    </section>
  );
}
