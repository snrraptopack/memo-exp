import { afterEach, expect, it } from 'bun:test';
import { createListRegion } from '@memoized-dom/runtime/testing';

afterEach(() => {document.body.replaceChildren();});

it.each(['single','multi','empty'] as const)('inserts around ordered survivors without moving their %s extents', shape => {
  const host = document.createElement('div'); document.body.append(host);
  const nodes = new Map<number, Node[]>(), calls: string[] = [];
  const region = createListRegion(host, 'ordered', (initial, _id, initialIndex) => {
    const extent = shape === 'empty' && initial.id % 2 === 0 ? [] :
      Array.from({length:shape === 'multi' ? 2 : 1}, () => document.createElement('span'));
    nodes.set(initial.id, extent); let item = initial, index = initialIndex;
    const render = () => extent.forEach(node => {node.textContent = `${item.id}@${index}:${item.label}`;}); render();
    return {nodes:shape === 'single' ? extent[0]! : extent,entities:[],
      update(value, position) {item = value as typeof initial; index = position;calls.push(`u${item.id}@${index}`); render();},
       dispose() {calls.push(`d${initial.id}`);}};
  }, (item:{id:number;label:string},index) => {calls.push(`k${item.id}@${index}`); return item.id;}, false, true);
  const observer = new MutationObserver(() => {}); observer.observe(host,{childList:true});
  const orders = [[0,1,2,3,4,5], [10,0,1,11,2,3,12,4,5,13], [10,1,14,3,15,5,13],
    [16,10,17,1,14,18,3,15,5,13,19], [16,17,14,18,15,13,19]];
  let previous: number[] = [];
  for (const [step,order] of orders.entries()) {
    const prior = new Map(nodes); calls.length = 0;
    region.reconcile(order.map(id=>({id,label:`step${step}`})));
    const inserted = [...observer.takeRecords()].flatMap(record => [...record.addedNodes]);
    for (const id of order.filter(id=>previous.includes(id))) {
      expect(nodes.get(id)).toBe(prior.get(id));
      for (const node of prior.get(id)!) expect(inserted).not.toContain(node);
    }
    expect([...host.children]).toEqual(order.flatMap(id=>nodes.get(id)!));
    order.forEach((id,index)=>nodes.get(id)!.forEach(node=>expect(node.textContent).toBe(`${id}@${index}:step${step}`)));
    expect(calls.filter(call=>call.startsWith('k'))).toEqual(order.map((id,index)=>`k${id}@${index}`));
    expect(calls.filter(call=>call.startsWith('u'))).toEqual(order.flatMap((id,index)=>previous.includes(id) ? [`u${id}@${index}`] : []));
    expect(calls.filter(call=>call.startsWith('d'))).toEqual(previous.filter(id=>!order.includes(id)).map(id=>`d${id}`));
    const disposal = calls.findIndex(call=>call.startsWith('d'));
    if (disposal >= 0) expect(calls.slice(disposal).every(call=>call.startsWith('d'))).toBe(true);
    previous = order;
  }
  calls.length = 0; region.refreshKey(14); expect(calls).toEqual(['u14@2']);
  observer.disconnect(); region.dispose(); expect(host.childNodes).toHaveLength(0);
});

it('rejects non-array sources without disturbing an existing list and accepts the next valid frame', () => {
  const host = document.createElement('ul'), disposed: number[] = [];
  const region = createListRegion(host,'invalid-payload',(item:number)=>{
    const node = document.createElement('li'); node.textContent=String(item);
    return {nodes:node,entities:[],dispose(){disposed.push(item);}};
  }, item=>item,false);
  region.reconcile([1,2]); const nodes = [...host.children];
  for (const invalid of [null,undefined,{photos:[3,4]},'photos',3]) {
    expect(()=>region.reconcile(invalid as unknown as number[])).toThrow(/requires an array/);
    expect([...host.children]).toEqual(nodes); expect(region.size()).toBe(2); expect(disposed).toEqual([]);
  }
  region.reconcile([0,1,2,3]); expect([...host.children].slice(1,3)).toEqual(nodes);
  region.dispose(); expect(disposed).toEqual([0,1,2,3]);
});
