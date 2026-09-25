import { useCounter } from 'hook-kit/useCounter';

export function App() {
  const [value, setValue] = useCounter(5);
  return <button onClick={() => setValue(previous => previous + 1)}>{value}</button>;
}
