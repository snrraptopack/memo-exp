import { useMemo, useState } from 'react';

console.log('hook-kit module evaluated');
const factor = 2;

export const useCounter = (initial: number) => {
  const [count, setCount] = useState(initial);
  const doubled = useMemo(() => count * factor, [count]);
  return [doubled, setCount];
};
