/** Same DOM, scheduler and retained identity gates for both compiler revisions. */
import { setScheduler } from '@memoized-dom/runtime';
import { App } from './compiled-helper-app';
import type { BenchRow } from './state-placement-browser';

setScheduler(run => run());
const root = App('HelperComparison', null) as HTMLElement;
document.body.append(root);
const list = root.querySelector('ul')!;
const count = list.children.length;
const original = new Map<number, Element>();
for (const row of list.children) original.set(Number(row.getAttribute('data-id')), row);
const click = (id: string) => root.querySelector<HTMLButtonElement>(`#${id}`)!.click();
const fresh = () => Array.from({ length: count }, (_, index) => index + 1);
function validate(expected: number[], selected = 500, allowNew = false): void {
  if (list.children.length !== expected.length) throw new Error('Wrong row count');
  for (let index = 0; index < expected.length; index++) {
    const id = expected[index]!;
    const row = list.children[index]!;
    if ((!allowNew || original.has(id)) && row !== original.get(id) || row.textContent !== `row ${id}` ||
        row.getAttribute('data-id') !== String(id) || row.className !== (id === selected ? 'danger' : '')) {
      throw new Error(`Wrong identity/content/class at ${index} (key ${id})`);
    }
  }
}
function reset(): void {
  original.clear();
  for (const row of list.children) original.set(Number(row.getAttribute('data-id')), row);
  click('fresh'); validate(fresh(), 500, true);
  for (const row of list.children) original.set(Number(row.getAttribute('data-id')), row);
}
const operations: Record<string, (values: number[]) => number[]> = {
  reverse: values => values.toReversed(),
  rotate: values => values.slice(1).concat(values.slice(0, 1)),
  drop: values => values.slice(0, -1),
};
function runAll(options: { samples: number; names?: string[] }): BenchRow[] {
  const results: BenchRow[] = [];
  validate(fresh());
  for (const [operation, update] of Object.entries(operations)) {
    const name = `${operation} 10k`;
    if (options.names && !options.names.includes(name)) continue;
    console.log(`measure ${name} / owner inline helper`);
    let expected = fresh();
    reset();
    const values: number[] = [];
    for (let sample = -5; sample < options.samples; sample++) {
      const start = performance.now(); click(operation); const elapsed = performance.now() - start;
      expected = update(expected); validate(expected);
      if (sample >= 0) values.push(elapsed);
      if (operation === 'drop') { reset(); expected = fresh(); }
    }
    const sorted = values.toSorted((a, b) => a - b);
    results.push({ name, timings: { 'owner-inline-helper': sorted[Math.floor(sorted.length / 2)]! },
      samples: { 'owner-inline-helper': values } });
  }
  reset(); click('mixed'); validate(fresh().toReversed(), 501);
  return results;
}
(window as unknown as { __runAll: typeof runAll }).__runAll = runAll;
