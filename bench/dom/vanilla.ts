/**
 * @file vanilla.ts
 * Hand-optimized vanilla JS baseline — the same app, zero framework.
 * This is the "how close to the metal are we" reference, modeled on the
 * official js-framework-benchmark vanilla implementations.
 */
import { buildData, type RowData } from './data';

interface RowRef {
  d: RowData;
  li: HTMLLIElement;
  t: Text;
}

export interface VanillaApp {
  root: HTMLElement;
  op(name: string): void;
  selectRow(index: number): void;
  rowCount(): number;
}

export function createVanillaApp(): VanillaApp {
  const root = document.createElement('div');
  const ul = document.createElement('ul');
  root.appendChild(ul);

  let rows: RowRef[] = [];
  let selectedEl: HTMLLIElement | null = null;

  function makeRow(d: RowData): RowRef {
    const li = document.createElement('li');
    const t = document.createTextNode(`${d.id}: ${d.label}`);
    li.appendChild(t);
    li.onclick = () => {
      if (selectedEl) selectedEl.classList.remove('danger');
      li.classList.add('danger');
      selectedEl = li;
    };
    return { d, li, t };
  }

  function createRows(count: number): void {
    ul.textContent = '';
    rows = [];
    selectedEl = null;
    const frag = document.createDocumentFragment();
    for (const d of buildData(count)) {
      const r = makeRow(d);
      rows.push(r);
      frag.appendChild(r.li);
    }
    ul.appendChild(frag);
  }

  const ops: Record<string, () => void> = {
    create1k: () => createRows(1000),
    create10k: () => createRows(10000),
    append1k: () => {
      const frag = document.createDocumentFragment();
      for (const d of buildData(1000)) {
        const r = makeRow(d);
        rows.push(r);
        frag.appendChild(r.li);
      }
      ul.appendChild(frag);
    },
    update: () => {
      for (let i = 0; i < rows.length; i += 10) {
        const r = rows[i]!;
        r.d.label += ' !!!';
        r.t.data = `${r.d.id}: ${r.d.label}`;
      }
    },
    swap: () => {
      if (rows.length > 998) {
        const a = rows[1]!;
        const b = rows[998]!;
        const bNext = b.li.nextSibling;
        ul.insertBefore(b.li, a.li);
        ul.insertBefore(a.li, bNext);
        rows[1] = b;
        rows[998] = a;
      }
    },
    remove: () => {
      const r = rows[500];
      if (r) {
        r.li.remove();
        rows.splice(500, 1);
      }
    },
    clear: () => {
      ul.textContent = '';
      rows = [];
      selectedEl = null;
    },
  };

  return {
    root,
    op(name: string) {
      ops[name]!();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}
