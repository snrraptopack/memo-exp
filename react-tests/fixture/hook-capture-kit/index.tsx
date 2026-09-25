import { useState } from 'react';

const moduleInitial = 1;

export function useCounter() {
  const [count, setCount] = useState(moduleInitial);
  return [count, setCount];
}

export function Counter() {
  const [count, setCount] = useCounter();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
