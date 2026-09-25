import { useMemo, useState } from 'react';

console.log('hook-kit module evaluated');

export const useCounter = (initial: number) => {
  const [count, setCount] = useState(initial);
  const doubled = useMemo(() => count * 2, [count]);
  return [doubled, setCount];
};
