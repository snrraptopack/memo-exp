/**
 * @file ours.ts
 * The benchmark app, hand-compiled in OUR paradigm (memo-dom).
 *
 * Static access table (what the M5 compiler will emit):
 *   data     -> read by the Main list region AND every Row (via item props)
 *   selected -> read by every Row
 *
 * Handlers use the PRODUCTION emission form: a direct closure ending in
 * commitWrites(WRITES) with a hoisted static write-set — not the dev-mode
 * handle() wrapper (which keeps the event log for debugging).
 *
 * Consequence worth watching in the numbers:
 *   - 'update' / 'swap' / 'remove' write `data` -> all rows re-render, but
 *     value-cached setters no-op the unchanged 900+ (over-approximation cost)
 *   - 'select' writes `selected` -> all rows re-render, 2 actual class writes
 */
import { register, type EntityId } from '../src/kernel';
import { installAccessTable } from '../src/access';
import { commitWrites } from '../src/events';
import { createListRegion, type ListEntry } from '../src/list';
import { setText, setClass, type SlotCache } from '../src/setters';
import { buildData, type RowData } from './data';

let data: RowData[] = [];
let selected: number | null = null;

installAccessTable(
  {
    readers: {
      data: ['Bench/Main', 'Bench/Main/Row[*]'],
      selected: ['Bench/Main/Row[*]'],
    },
  },
  'Bench',
);

// Static write-sets — hoisted constants, exactly what the compiler emits.
const WRITES_SELECTED = ['selected'] as const;
const WRITES_DATA = ['data'] as const;

function Row(rowId: EntityId, item: RowData): ListEntry {
  // Creation: write initial values DIRECTLY and seed the cache — what the
  // compiler emits. Calling the guarded setters on empty nodes would pay
  // redundant DOM writes at mount (measured in M4).
  const label0 = `${item.id}: ${item.label}`;
  const $: SlotCache = { l: label0, s: false };
  const li = document.createElement('li');
  const t = document.createTextNode(label0);
  li.appendChild(t);

  li.onclick = () => {
    selected = item.id;
    commitWrites(WRITES_SELECTED);
  };

  function update() {
    setText($, 'l', t, `${item.id}: ${item.label}`);
    setClass($, 's', li, 'danger', selected === item.id);
  }

  register({ id: rowId, parent: 'Bench/Main', render: update });
  return { nodes: [li], entities: [rowId] };
}

export interface BenchApp {
  root: HTMLElement;
  click(name: string): void;
  selectRow(index: number): void;
  rowCount(): number;
}

export function createBenchApp(): BenchApp {
  const root = document.createElement('div');
  const toolbar = document.createElement('div');
  const ul = document.createElement('ul');
  root.append(toolbar, ul);

  const region = createListRegion<RowData>(
    ul,
    'Bench/Main',
    (item, rowId) => Row(rowId, item),
    (i) => i.id,
  );

  register({ id: 'Bench', parent: null, render: () => {} });
  register({ id: 'Bench/Main', parent: 'Bench', render: () => region.reconcile(data) });
  region.reconcile(data);

  function btn(name: string, op: () => void): void {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => {
      op();
      commitWrites(WRITES_DATA);
    };
    toolbar.appendChild(b);
  }

  // NOTE: `selected = null` piggybacks on data ops; rows are recreated or
  // guarded no-op either way, so no separate `selected` write is needed here.
  btn('create1k', () => { data = buildData(1000); selected = null; });
  btn('create10k', () => { data = buildData(10000); selected = null; });
  btn('append1k', () => { data = data.concat(buildData(1000)); });
  btn('update', () => {
    for (let i = 0; i < data.length; i += 10) data[i]!.label += ' !!!';
  });
  btn('swap', () => {
    if (data.length > 998) {
      const t = data[1]!;
      data[1] = data[998]!;
      data[998] = t;
    }
  });
  btn('remove', () => { data.splice(500, 1); });
  btn('clear', () => { data = []; selected = null; });

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      b.click();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}
