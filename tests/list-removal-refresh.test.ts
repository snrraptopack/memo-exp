import { expect, it } from 'bun:test';
import { createListRegion } from '@memoized-dom/runtime/testing';

for (const order of [[1, 2], [2, 4]]) {
  it.each(['props', 'update'] as const)(`hides consumed removal survivors during %s (${order})`, phase => {
    const host = document.createElement('ul');
    const calls: string[] = [];
    let observing = false, refreshing = false;
    const region = createListRegion(host, 'removal-refresh', (initial, _id, initialIndex) => {
      const node = document.createElement('li');
      let item = initial, index = initialIndex;
      const refresh = () => {
        if (!observing || refreshing) return;
        refreshing = true;
        try { region.refreshKey(item.id); } finally { refreshing = false; }
      };
      const render = () => { node.textContent = `${item.id}@${index}:${item.label}`; };
      render();
      return { nodes: node, entities: [],
        update(next, position) {
          item = next as typeof initial; index = position;
          if (observing) calls.push(`p${item.id}@${index}`);
          if (phase === 'props') refresh();

          if (observing) calls.push(`u${item.id}@${index}`);
          if (phase === 'update') refresh();
          render();
        },

      };
    }, (item: { id: number; label: string }) => item.id, false, true);
    region.reconcile([1, 2, 3, 4].map(id => ({ id, label: 'old' })));
    const nodes = [...host.children]; observing = true;
    try {
      region.reconcile(order.map(id => ({ id, label: 'new' })));
      expect(calls).toEqual(order.flatMap((id, index) => [`p${id}@${index}`, `u${id}@${index}`]));
      expect([...host.children]).toEqual(order.map(id => nodes[id - 1]));
      expect([...host.children].map(node => node.textContent)).toEqual(order.map((id, index) => `${id}@${index}:new`));
      calls.length = 0; observing = false;
      region.refreshKey(order[0]);
      expect(host.children[0]!.textContent).toBe(`${order[0]}@0:new`);
    } finally { region.dispose(); }
  });

  it(`does not refresh survivors with the previous snapshot during removal cleanup (${order})`, () => {
    const host = document.createElement('ul');
    const calls: string[] = [], removed: number[] = [];
    let observing = false;
    const region = createListRegion(host, 'removal-cleanup-refresh', (initial, _id, initialIndex) => {
      const node = document.createElement('li');
      let item = initial, index = initialIndex;
      const render = () => { node.textContent = `${item.id}@${index}:${item.label}`; };
      render();
      return { nodes: node, entities: [],
        update(next, position) { item = next as typeof initial; index = position;  calls.push(`u${item.id}@${index}`); render(); },

        dispose() {
          removed.push(initial.id);
          if (observing) for (const id of order) region.refreshKey(id);
        },
      };
    }, (item: { id: number; label: string }) => item.id, false, true);
    region.reconcile([1, 2, 3, 4].map(id => ({ id, label: 'old' })));
    const nodes = [...host.children]; observing = true;
    try {
      region.reconcile(order.map(id => ({ id, label: 'new' })));
      expect(calls).toEqual(order.map((id, index) => `u${id}@${index}`));
      expect(removed).toEqual([1, 2, 3, 4].filter(id => !order.includes(id)));
      expect([...host.children]).toEqual(order.map(id => nodes[id - 1]));
      expect([...host.children].map(node => node.textContent)).toEqual(order.map((id, index) => `${id}@${index}:new`));
      observing = false; calls.length = 0;
      region.refreshKey(order[1]);
      expect(calls).toEqual([`u${order[1]}@1`]);
    } finally { observing = false; region.dispose(); }
  });

  it.each(['props', 'update'] as const)(`recovers or disposes a removal interrupted in %s (${order})`, phase => {
    const host = document.createElement('ul');
    const disposed: number[] = [], calls: number[] = [];
    const failure = new Error('retained callback');
    let throwing = false;
    const region = createListRegion(host, 'removal-interrupted', (initial, _id, initialIndex) => {
      const node = document.createElement('li');
      let item = initial, index = initialIndex;
      const render = () => { node.textContent = `${item.id}@${index}:${item.label}`; };
      render();
      return { nodes: node, entities: [],
        update(next, position) {
          item = next as typeof initial; index = position;
          if (throwing && phase === 'props') throw failure;
         calls.push(item.id); if (throwing && phase === 'update') throw failure; render(); },

        dispose() { disposed.push(initial.id); },
      };
    }, (item: { id: number; label: string }) => item.id, false, true);
    region.reconcile([1, 2, 3, 4].map(id => ({ id, label: 'old' })));
    const nodes = [...host.children]; throwing = true;
    try {
      expect(() => region.reconcile(order.map(id => ({ id, label: 'failed' })))).toThrow(failure);
      throwing = false; calls.length = 0;
      region.refreshKey(order[0]); expect(calls).toEqual([]);
      region.reconcile(order.map(id => ({ id, label: 'recovered' })));
      expect([...host.children]).toEqual(order.map(id => nodes[id - 1]));
      expect([...host.children].map(node => node.textContent)).toEqual(order.map((id, index) => `${id}@${index}:recovered`));
      calls.length = 0; region.refreshKey(order[1]); expect(calls).toEqual([order[1]]);
      // Another interrupted removal must still own every row for unmount.
      throwing = true;
      expect(() => region.reconcile([{ id: order[0]!, label: 'failed again' }])).toThrow(failure);
    } finally { region.dispose(); region.dispose(); }
    expect(disposed.sort()).toEqual([1, 2, 3, 4]);
    expect(host.childNodes).toHaveLength(0);
  });
}

it('keeps unconsumed old rows refreshable while survivor bindings move forward', () => {
  const host = document.createElement('ul');
  const calls: string[] = [];
  let observing = false;
  const region = createListRegion(host, 'removal-forward', (initial, _id, initialIndex) => {
    const node = document.createElement('li'); let item = initial, index = initialIndex;
    const render = () => { node.textContent = `${item.id}@${index}:${item.label}`; };
    render();
    return { nodes: node, entities: [],
      update(next, position) { item = next as typeof initial; index = position;
        calls.push(`u${item.id}@${index}:${region.size()}`);
        if (observing && item.id === 2) region.refreshKey(4);
        render();
      },

    };
  }, (item: { id: number; label: string }) => item.id, false, true);
  region.reconcile([1, 2, 3, 4].map(id => ({ id, label: 'old' })));
  const nodes = [...host.children]; observing = true;
  try {
    region.reconcile([2, 4].map(id => ({ id, label: 'new' })));
    expect(calls).toEqual(['u2@0:3', 'u4@3:3', 'u4@1:2']);
    expect([...host.children]).toEqual([nodes[1], nodes[3]]);
    expect([...host.children].map(node => node.textContent)).toEqual(['2@0:new', '4@1:new']);
    expect(region.size()).toBe(2);
  } finally { region.dispose(); }
});

it.each([false, true])('preserves structural-only replay precision during cleanup (indexSensitive=%s)', indexSensitive => {
  const host = document.createElement('ul');
  const items = [1, 2, 3, 4].map(id => ({ id }));
  const calls: string[] = [];
  let observing = false;
  const region = createListRegion(host, 'removal-structural-refresh', (initial, _id, initialIndex) => {
    const node = document.createElement('li'); let item = initial, index = initialIndex;
    node.textContent = String(item.id);
    return { nodes: node, entities: [],
      update(next, position) { item = next as typeof initial; index = position;  calls.push(`${item.id}@${index}`); },

      dispose() { if (observing) { region.refreshKey(2); region.refreshKey(4); } },
    };
  }, item => item.id, false, indexSensitive);
  region.reconcile(items); const nodes = [...host.children]; observing = true;
  try {
    region.reconcile([items[1]!, items[3]!], true);
    expect(calls).toEqual(indexSensitive ? ['2@0', '4@1'] : []);
    expect([...host.children]).toEqual([nodes[1], nodes[3]]);
    calls.length = 0; region.refreshKey(4); expect(calls).toEqual(['4@1']);
  } finally { observing = false; region.dispose(); }
});
