import { useCounter } from './hooks';

export function Counter() {
  const [value, setValue] = useCounter();
  return <button onClick={() => setValue(value + 1)}>{value}</button>;
}
