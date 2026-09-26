import { NestedRows } from 'row-nested-kit';

export function App() {
  let items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  let className = 'row';
  return <main>
    <button id="add" onClick={() => { items = [...items, { id: 'c', label: 'C' }]; }}>add</button>
    <button id="remove" onClick={() => { items = items.slice(1); }}>remove</button>
    <button id="app-toggle" onClick={() => { className = className === 'row' ? 'selected' : 'row'; }}>style</button>
    <NestedRows className={className}>
      {items.map(item => <span key={item.id}>{item.label}</span>)}
    </NestedRows>
  </main>;
}
