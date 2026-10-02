import { setScheduler, unregister } from '@memoized-dom/runtime';
import { variants } from './dist/update-style/apps';
import type { UpdateStyleRow } from './update-style-report';

setScheduler(run => run());
const operations = ['update','swap','append1k','remove'] as const;
let seed = 123;
Math.random = () => {
  seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
type Operation = typeof operations[number];
interface Snapshot { id: string; text: string; className: string; node: Element }
function snapshot(root: HTMLElement): Snapshot[] {
  return [...root.querySelector('ul')!.children].map(node => {
    const text = node.textContent ?? '';
    return {id:text.split(':')[0]!,text,className:node.className,node};
  });
}
function click(root: HTMLElement, name: string): void {
  const button = [...root.querySelectorAll('button')].find(node => node.textContent === name);
  if (!button) throw new Error('Missing update-style button: ' + name);
  button.click();
}
function validate(id: string, root: HTMLElement, operation: Operation, before: Snapshot[]): void {
  const actual = snapshot(root);
  const retained = new Map(before.map(row => [row.id,row]));
  if (new Set(actual.map(row => row.id)).size !== actual.length || actual.some(row => !/^\d+: .+/.test(row.text))) {
    throw new Error(`${id}/${operation}: malformed rows`);
  }
  for (const row of actual) {
    const previous = retained.get(row.id);
    if (previous && row.node !== previous.node) throw new Error(`${id}/${operation}: recreated retained row`);
  }
  let expected = before;
  if (operation === 'update') expected = before.map((row,index) => ({...row,text:row.text + (index % 10 === 0 ? ' !!!' : '')}));
  if (operation === 'swap') { expected = [...before]; [expected[1],expected[998]] = [expected[998]!,expected[1]!]; }
  if (operation === 'remove') expected = before.filter((_,index) => index !== 500);
  if (operation === 'append1k') {
    const added = actual.slice(before.length);
    if (added.length !== 1000 || added.some(row => retained.has(row.id) || row.className !== '')) throw new Error(`${id}: incorrect appended rows`);
    expected = [...before,...added];
  }
  if (actual.length !== expected.length || actual.some((row,index) => {
    const wanted = expected[index]!;
    return row.id !== wanted.id || row.text !== wanted.text || row.className !== wanted.className;
  })) throw new Error(`${id}/${operation}: incorrect text, order, classes or count`);
}
function exercise(variant: typeof variants[number], count: number, operation: Operation, timed: boolean): number {
  seed = 123;
  const root = variant.create(); document.body.append(root);
  try {
    click(root,count === 1000 ? 'create1k' : 'create10k');
    const rows = snapshot(root);
    if (rows.length !== count || rows.some(row => row.className !== '')) throw new Error(variant.id + ': incorrect initial rows');
    (rows[500]!.node as HTMLElement).click();
    const before = snapshot(root);
    if (before.some((row,index) => row.node !== rows[index]!.node || row.text !== rows[index]!.text || row.className !== (index === 500 ? 'danger' : ''))) throw new Error(variant.id + ': incorrect selection');
    const start = timed ? performance.now() : 0;
    click(root,operation);
    const elapsed = timed ? performance.now() - start : 0;
    validate(variant.id,root,operation,before);
    return elapsed;
  } finally {
    click(root,'clear'); unregister(variant.rootId); root.remove();
  }
}
function validateAll(): void {
  for (const variant of variants) {
    for (const count of [1000,10000]) for (const operation of operations) exercise(variant,count,operation,false);
    // Selected removal followed by replacement/append must not revive the old key.
    const root = variant.create(); document.body.append(root);
    try {
      click(root,'create1k'); (root.querySelector('ul')!.children[500] as HTMLElement).click();
      for (const operation of ['update','swap','remove','append1k'] as const) {
        const before = snapshot(root); click(root,operation); validate(variant.id,root,operation,before);
      }
      const previous = snapshot(root); (previous[501]!.node as HTMLElement).click();
      const actual = snapshot(root);
      if (actual.some((row,index) => row.node !== previous[index]!.node || row.text !== previous[index]!.text || row.className !== (index === 501 ? 'danger' : ''))) throw new Error(variant.id + ': selection after mixed sequence');
    } finally { click(root,'clear'); unregister(variant.rootId); root.remove(); }
    console.info('validate update styles: ' + variant.id);
  }
}
function runAll(samples = 7): UpdateStyleRow[] {
  if (!Number.isInteger(samples) || samples < 1) throw new Error('Invalid sample count');
  validateAll();
  const results: UpdateStyleRow[] = [];
  for (const count of [1000,10000]) for (const operation of operations) {
    const values = new Map(variants.map(variant => [variant.id,[] as number[]]));
    for (let sample=-1;sample<samples;sample++) for (let offset=0;offset<variants.length;offset++) {
      const variant = variants[(sample + 1 + offset) % variants.length]!;
      const elapsed = exercise(variant,count,operation,sample >= 0);
      if (sample >= 0) values.get(variant.id)!.push(elapsed);
    }
    const timings: Record<string,number> = {};
    for (const [id,times] of values) timings[id] = times.sort((a,b) => a-b)[Math.floor(times.length/2)]!;
    results.push({name:`${operation} ${count/1000}k`,timings});
    console.info(`measure update styles: ${operation} ${count/1000}k`);
  }
  return results;
}
(window as unknown as Record<string,unknown>).__validateUpdateStyles = validateAll;
(window as unknown as Record<string,unknown>).__runUpdateStyles = runAll;
