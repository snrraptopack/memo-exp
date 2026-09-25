import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, increment } from './store';

export function Counter() {
  const value = useSyncExternalStore(subscribe, getSnapshot);
  return <button onClick={increment}>{value}</button>;
}
