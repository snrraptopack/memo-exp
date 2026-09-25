import { useCounter } from './useCounter';

export function Counter() {
  const moduleInitial = 99;
  const [count, setCount] = useCounter();
  return <button title={String(moduleInitial)} onClick={() => setCount(count + 1)}>{count}</button>;
}
