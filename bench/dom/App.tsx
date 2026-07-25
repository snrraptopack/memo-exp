/**
 * @file App.tsx
 * The TSX source code for the Component Row Benchmark App.
 */
import { buildData, type RowData } from './data';

let data: RowData[] = [];
let selected: number | null = null;

function Row(props: { item: RowData }) {
  return (
    <li
      class={selected === props.item.id ? 'danger' : ''}
      onClick={() => {
        selected = props.item.id;
      }}
    >
      {props.item.id}: {props.item.label}
    </li>
  );
}

export function BenchApp() {
  return (
    <div>
      <div class="toolbar">
        <button onClick={() => { data = buildData(1000); selected = null; }}>create1k</button>
        <button onClick={() => { data = buildData(10000); selected = null; }}>create10k</button>
        <button onClick={() => { data = data.concat(buildData(1000)); }}>append1k</button>
        <button onClick={() => {
          for (let i = 0; i < data.length; i += 10) data[i]!.label += ' !!!';
        }}>update</button>
        <button onClick={() => {
          if (data.length > 998) {
            const t = data[1]!;
            data[1] = data[998]!;
            data[998] = t;
          }
        }}>swap</button>
        <button onClick={() => { data.splice(500, 1); }}>remove</button>
        <button onClick={() => { data = []; selected = null; }}>clear</button>
      </div>
      <ul>
        {data.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}
