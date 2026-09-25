import { useState } from 'react';

export const useCounter = function () {
  const [count, setCount] = useState(1);
  return [count, setCount];
};

export function Counter() {
  const [count, setCount] = useCounter();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
