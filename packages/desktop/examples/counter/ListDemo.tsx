import type {} from '@memoized-dom/compiler/jsx';
import './app.css';

export function ListDemo() {
  let items = [{ id: 1, label: 'First' }, { id: 2, label: 'Second' }, { id: 3, label: 'Third' }];
  let nextId = 4;
  return <section id="list-demo" class="counter">
    <h2>Keyed native rows</h2>
    <p>Type or click in a row, then reverse the order. Its state follows its key.</p>
    <div class="actions">
      <button onClick={() => items = items.toReversed()}>Reverse rows</button>
      <button onClick={() => { items = [...items, { id: nextId, label: 'Added' }]; nextId++; }}>Add row</button>
      <button onClick={() => items = items.slice(1)}>Remove first</button>
    </div>
    <ul class="native-list">
      {items.map((item, index) => <ListRow key={item.id} label={item.label} position={index} />)}
    </ul>
  </section>;
}

function ListRow({ label, position }: { label: string; position: number }) {
  let clicks = 0;
  let draft = '';
  return <li class="list-row">
    <p>{label}: {position}</p>
    <button onClick={() => clicks++}>Row clicks: {clicks}</button>
    <input type="text" value={draft} onChange={event => draft = event.currentTarget.value} placeholder="State follows this row" />
    <p>Draft: {draft}</p>
  </li>;
}
