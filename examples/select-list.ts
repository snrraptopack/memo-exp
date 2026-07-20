/**
 * @file select-list.ts
 * HAND-COMPILED demo app for M3: module-level shared state, a hand-written
 * access table, and handlers that NEVER call markDirty directly — handle()
 * routes their static write-sets to exactly the components that read what
 * changed.
 *
 * Layout:
 *   App
 *   ├── Header/Badge      reads: selectedId
 *   ├── SelectList        reads: (nothing dynamic in this demo)
 *   │   └── Row[*]        reads: selectedId    writes: selectedId (on click)
 *   └── Footer            reads: filter        writes: filter (input), prefs (opaque)
 */
import { register, type EntityId } from '../src/kernel';
import { installAccessTable } from '../src/access';
import { handle } from '../src/events';
import { createListRegion, type ListEntry } from '../src/list';
import { setText, setClass, type SlotCache } from '../src/setters';

// ---- module state (shared across components) ---------------------------------
let selectedId: number | null = null;
let filter = '';
const prefs: Record<string, unknown> = { theme: 'light' };

/** Test hook only — module state is app-level, so tests reset it explicitly. */
export function __resetSelectListState(): void {
  selectedId = null;
  filter = '';
}

// ---- the STATIC ACCESS TABLE (hand-written; the M5 compiler will emit this) --
installAccessTable(
  {
    readers: {
      selectedId: ['App/SelectList/Row[*]', 'App/Header/Badge'],
      filter: ['App/Footer'],
    },
    opaque: ['prefs'], // written via dynamic keys -> defeats analysis
  },
  'App',
);

export interface Item {
  id: number;
  label: string;
}

// ---- Badge -------------------------------------------------------------------
function Badge(id: EntityId, parent: EntityId): HTMLSpanElement {
  const $: SlotCache = {};
  const span = document.createElement('span');
  const text = document.createTextNode('');
  span.appendChild(text);

  function update() {
    setText($, 'sel', text, selectedId === null ? 'none' : `selected: ${selectedId}`);
  }

  register({ id, parent, render: update });
  update();
  return span;
}

// ---- Row (created per item by the list region) --------------------------------
function Row(rowId: EntityId, listId: EntityId, item: Item): ListEntry {
  const $: SlotCache = {};
  const li = document.createElement('li');
  const text = document.createTextNode('');
  li.appendChild(text);

  // No markDirty in sight: handle() routes writes: ['selectedId'] to the
  // readers of selectedId — all rows + the badge.
  li.onclick = handle<MouseEvent>(rowId, ['selectedId'], () => {
    selectedId = item.id;
  });

  function update() {
    setText($, 'label', text, item.label);
    setClass($, 'sel', li, 'selected', selectedId === item.id);
  }

  register({ id: rowId, parent: listId, render: update });
  update();
  return { nodes: [li], entities: [rowId] };
}

// ---- SelectList ----------------------------------------------------------------
function SelectList(id: EntityId, parent: EntityId, items: Item[]): HTMLUListElement {
  const ul = document.createElement('ul');
  const region = createListRegion<Item>(
    ul,
    id,
    (item, rowId) => Row(rowId, id, item),
    (i) => i.id,
  );
  register({ id, parent, render: () => {} }); // rows self-manage in this demo
  region.reconcile(items);
  return ul;
}

// ---- Footer --------------------------------------------------------------------
function Footer(id: EntityId, parent: EntityId): HTMLElement {
  const $: SlotCache = {};
  const footer = document.createElement('footer');
  const input = document.createElement('input');
  const text = document.createTextNode('');
  const prefsBtn = document.createElement('button');
  prefsBtn.textContent = 'prefs';
  footer.append(input, text, prefsBtn);

  input.oninput = handle<Event>(id, ['filter'], () => {
    filter = input.value;
  });

  // dynamic member access -> the variable is opaque -> root-subtree fallback
  prefsBtn.onclick = handle<MouseEvent>(id, ['prefs'], () => {
    prefs[Math.random() > 0.5 ? 'a' : 'b'] = Date.now();
  });

  function update() {
    setText($, 'f', text, `filter: ${filter}`);
  }

  register({ id, parent, render: update });
  update();
  return footer;
}

// ---- App root -------------------------------------------------------------------
export function SelectListApp(items: Item[]): HTMLDivElement {
  // INVARIANT (M4): parents register before children, so child links exist.
   register({ id: 'App', parent: null, render: () => {} });
  const root = document.createElement('div');
  const header = document.createElement('header');
  header.appendChild(Badge('App/Header/Badge', 'App'));
  const ul = SelectList('App/SelectList', 'App', items);
  const footer = Footer('App/Footer', 'App');
  root.append(header, ul, footer);
  return root;
}
