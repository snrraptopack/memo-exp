import { useState } from 'react';

const moduleInitial = 1;

export function useCounter() {
  const [count, setCount] = useState(moduleInitial);
  return [count, setCount];
}
