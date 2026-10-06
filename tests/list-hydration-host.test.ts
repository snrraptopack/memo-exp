import { afterEach, expect, it, vi } from 'vitest';
import { claimHydrationRoot, HydrationDocument, HydrationMismatchError } from '../packages/runtime/src/hydration';
import { hydrateList } from '../packages/runtime/src/hydration-list';
import { getActiveEnvironment, runWithRenderEnvironment } from '../packages/runtime/src/kernel';
import { createListRegion, type ListRegion } from '../packages/runtime/src/list';
import { createPositionalListRegion } from '../packages/runtime/src/list-positional';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function hydrate(positional: boolean, labels: string[], run: (region: ListRegion<string>, host: HTMLElement, doc: HydrationDocument) => void,
  factory?: (item: string, index: number, region: ListRegion<string>) => void) {
  const host = document.createElement('div');
  host.innerHTML = '<!--mmd:r:App--><ul><!--mmd:l:Rows-->' +
    labels.map((label, index) => `<!--mmd:w:Rows:n:${index}--><li>${label}</li>`).join('') +
    '<!--/mmd--></ul><!--/mmd-->';
  document.body.append(host);
  const doc = new HydrationDocument(document, claimHydrationRoot(host, 'App'), { list: hydrateList });
  let region: ListRegion<string> | undefined;
  try {
    runWithRenderEnvironment({ mode: 'hydrate', document: doc, hydration: doc }, () => {
      const create = (item: string, _id: string, index: number) => {
        factory?.(item, index, region!);
        const active = getActiveEnvironment().document;
        const text = active.createTextNode(item);
        const node = active.createElement('li');
        node.appendChild(text);
        return { nodes: node, entities: [], update(next: unknown) { text.data = String(next); } };
      };
      region = positional ? createPositionalListRegion(host.querySelector('ul')!, 'Rows', create)
        : createListRegion(host.querySelector('ul')!, 'Rows', create, (_item, index) => index, false, true, true);
      run(region, host, doc);
    });
  } finally { doc.finishHydration(); region?.dispose(); }
}

it.each([false, true])('retains rows without creating or moving nodes through the hydration host (positional=%s)', positional => {
  hydrate(positional, ['a', 'b'], (region, host, doc) => {
    const rows = [...host.querySelectorAll('li')];
    const create = vi.spyOn(document, 'createElement');
    const insert = vi.spyOn(host.querySelector('ul')!, 'insertBefore');
    region.reconcile(['a', 'b']);
    doc.createElement('ul'); doc.expectDone();
    expect([...host.querySelectorAll('li')]).toEqual(rows);
    expect(create).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
    doc.finishHydration();
    runWithRenderEnvironment({ mode: 'client-create', document }, () => region.reconcile(['changed', 'b', 'c']));
    expect(host.querySelector('li')).toBe(rows[0]);
    expect([...host.querySelectorAll('li')].map(node => node.textContent)).toEqual(['changed', 'b', 'c']);
    region.dispose(); expect(host.querySelector('ul')!.childNodes).toHaveLength(0);
  });
});

it.each([false, true])('rejects additional server rows at the end of adoption (positional=%s)', positional => {
  hydrate(positional, ['a', 'b'], region => {
    expect(() => region.reconcile(['a'])).toThrow(/additional server row content/);
  });
});

it.each([false, true])('preserves the authored failure when the row cursor also fails (positional=%s)', positional => {
  hydrate(positional, ['a'], (region, _host, doc) => {
    const pop = vi.spyOn(doc, 'popRange');
    let caught = false;
    try { region.reconcile(['a']); }
    catch (error) { caught = true; expect(error).toBeUndefined(); }
    expect(caught).toBe(true); expect(pop).toHaveBeenCalledOnce();
    expect(pop.mock.results[0]!.type).toBe('throw');
  }, () => { throw undefined; });
});

it.each([false, true])('reports an unconsumed row when the factory succeeds (positional=%s)', positional => {
  hydrate(positional, ['a'], (region, _host, doc) => {
    // A host factory that consumes nothing cannot silently adopt row content.
    vi.spyOn(doc, 'createTextNode').mockImplementation(() => document.createTextNode('a'));
    vi.spyOn(doc, 'createElement').mockImplementation(() => document.createElement('li'));
    expect(() => region.reconcile(['a'])).toThrow(HydrationMismatchError);
  });
});

it.each([false, true])('remains disposed when a row factory disposes its region (positional=%s)', positional => {
  hydrate(positional, ['a'], (region, host) => {
    region.reconcile(['a']);
    expect(region.size()).toBe(0);
    expect(host.querySelector('li')).toBeNull();
    region.reconcile(['never']); expect(host.querySelector('li')).toBeNull();
  }, (_item, _index, region) => { region.dispose(); });
});

it('rejects unstable object keys in the hydration controller before row creation', () => {
  const host = document.createElement('div');
  host.innerHTML = '<!--mmd:r:App--><!--mmd:l:Rows--><!--/mmd--><!--/mmd-->';
  const doc = new HydrationDocument(document, claimHydrationRoot(host, 'App'), { list: hydrateList });
  const create = vi.fn();
  try {
    const list = doc.claimList(host, 'Rows');
    expect(() => list.adoptRow({}, null, create)).toThrow(/hydration-stable primitive row key.*object key/);
    expect(create).not.toHaveBeenCalled();
  } finally { doc.finishHydration(); }
});
