import { counter, increment } from './state';

export function Counter() {
  return <button onClick={() => increment()}>{counter.value}</button>;
}
