import { useState } from 'react';

export function App() {
  const [prefix, setPrefix] = useState('A');
  const store = { items: [{ id: 'one', label: 'one' }] };
  let suffix = '!';
  return <main>
    <button id="react-state" onClick={() => setPrefix(previous => previous === 'A' ? 'B' : 'A')}>prefix</button>
    <button id="mmd-list" onClick={() => store.items.push({ id: 'two', label: 'two' })}>add</button>
    <button id="mmd-state" onClick={() => { suffix = suffix === '!' ? '?' : '!'; }}>suffix</button>
    <ul>{store.items.map(item => <li key={item.id}>{prefix}:{item.label}{suffix}</li>)}</ul>
  </main>;
}
