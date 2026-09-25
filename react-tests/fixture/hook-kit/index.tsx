import { useCounter } from './useCounter';

export function Counter() {
  const [value, setValue] = useCounter(1);
  const [other, setOther] = useCounter(10);
  return <button onClick={() => {
    setValue(previous => previous + 1);
    setOther(previous => previous + 1);
  }}>{value}:{other}</button>;
}
