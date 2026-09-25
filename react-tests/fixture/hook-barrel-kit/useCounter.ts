import { useState } from 'react';

export function useCounter() {
  const [count, setCount] = useState(3);
  return [count, setCount];
}
