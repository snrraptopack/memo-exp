import { Children, useState } from 'react';

function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount];
}

function Rows({ children }: { children: unknown }) {
  return <ul>{Children.map(children, child => <li>{child}</li>)}</ul>;
}

export function App() {
  const [count, setCount] = useCounter();
  const state = { items: [{ id: 'a', label: 'A' }] };
  return <main>
    <button id="increment" onClick={() => setCount(previous => previous + 1)}>increment</button>
    <button id="add" onClick={() => state.items.push({ id: 'b', label: 'B' })}>add</button>
    <Rows>{state.items.map(item => <span key={item.id}>{item.label}:{count}</span>)}</Rows>
  </main>;
}
