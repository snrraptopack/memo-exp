import { useState } from 'react';

const settings = { initial: 1 };

export function useCounter() {
  const [count, setCount] = useState(settings.initial);
  return [count, setCount];
}

export function Counter() {
  const [count, setCount] = useCounter();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
