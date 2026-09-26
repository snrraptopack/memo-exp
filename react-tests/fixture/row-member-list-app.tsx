import { RowList } from 'row-kit';

export function App() {
  const state = { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
  return <main>
    <button id="add" onClick={() => state.items.push({ id: 'c', label: 'C' })}>add</button>
    <button id="remove" onClick={() => state.items.shift()}>remove</button>
    <RowList>{state.items.map(item => <span key={item.id}>{item.label}</span>)}</RowList>
  </main>;
}
