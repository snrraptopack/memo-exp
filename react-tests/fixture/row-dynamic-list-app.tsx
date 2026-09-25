import { RowList } from 'row-kit';

export function App() {
  let items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  return <main>
    <button id="add" onClick={() => { items = [...items, { id: 'c', label: 'C' }]; }}>add</button>
    <button id="remove" onClick={() => { items = items.slice(1); }}>remove</button>
    <RowList>{items.map(item => <span key={item.id}>{item.label}</span>)}</RowList>
  </main>;
}
