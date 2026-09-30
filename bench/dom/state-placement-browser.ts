/** Real-browser DOM benchmark: state placement crossed with row representation. */
import { setScheduler } from '@memoized-dom/runtime';
import { createVanillaApp } from './vanilla';
import { createCompiledTsxApp } from './compiled-tsx-app';
import { createCompiledInlineApp } from './compiled-inline-app';
import { createCompiledOwnedApp } from './compiled-owned-app';
import { createCompiledInlineOwnedApp } from './compiled-inline-owned-app';
import { createModuleDataComponent } from './compiled-module-data-component';
import { createModuleDataInline } from './compiled-module-data-inline';
import { createModuleSelectionComponent } from './compiled-module-selection-component';
import { createModuleSelectionInline } from './compiled-module-selection-inline';

setScheduler(fn => fn());
const RUNS = 7;
interface App {
  root: HTMLElement;
  click?(name: string): void;
  op?(name: string): void;
  selectRow(index: number): void;
  rowCount(): number;
}
const adapters: Array<{ id: string; app: App }> = [
  { id: 'module-component', app: createCompiledTsxApp() },
  { id: 'module-inline', app: createCompiledInlineApp() },
  { id: 'owner-component', app: createCompiledOwnedApp() },
  { id: 'owner-inline', app: createCompiledInlineOwnedApp() },
  { id: 'module-data-component', app: createModuleDataComponent() },
  { id: 'module-data-inline', app: createModuleDataInline() },
  { id: 'module-selection-component', app: createModuleSelectionComponent() },
  { id: 'module-selection-inline', app: createModuleSelectionInline() },
  { id: 'vanilla', app: createVanillaApp() },
];
for (const { app } of adapters) document.body.append(app.root);
const operate = (app: App, name: string): void => {
  if (app.click) app.click(name);
  else app.op!(name);
};
interface Scenario { name: string; count: number; operation: string }
const scenarios: Scenario[] = [
  { name: 'create 1k', count: 0, operation: 'create1k' },
  { name: 'create 10k', count: 0, operation: 'create10k' },
  ...[1000, 10000].flatMap(count => [
    'replace', 'update', 'select', 'transition', 'swap', 'remove', 'clear',
  ].map(operation => ({ name: `${operation} ${count / 1000}k`, count, operation }))),
  ...['append1k', 'prepend1k', 'pop1k', 'reverse', 'remove100'].map(operation => ({
    name: `${operation} 10k`, count: 10000, operation,
  })),
];
interface Row { text: string; className: string }
function snapshot(app: App): Row[] {
  return [...app.root.querySelectorAll('li')].map(row => ({
    text: row.textContent ?? '', className: row.className,
  }));
}
function setup(app: App, scenario: Scenario): void {
  operate(app, 'clear');
  if (scenario.count) operate(app, scenario.count === 1000 ? 'create1k' : 'create10k');
  if (scenario.operation === 'transition') app.selectRow(500);
}
function run(app: App, scenario: Scenario): void {
  if (scenario.operation === 'select') app.selectRow(500);
  else if (scenario.operation === 'transition') app.selectRow(501);
  else operate(app, scenario.operation === 'replace'
    ? (scenario.count === 1000 ? 'create1k' : 'create10k') : scenario.operation);
}
function validate(id: string, app: App, scenario: Scenario, before: Row[]): void {
  const actual = snapshot(app);
  const ids = actual.map(row => row.text.split(':')[0]);
  if (new Set(ids).size !== ids.length || actual.some(row => !/^\d+: .+/.test(row.text)) ||
      actual.length !== app.rowCount()) throw new Error(`${id}: malformed rows in ${scenario.name}`);
  let expected: Row[];
  switch (scenario.operation) {
    case 'create1k': case 'create10k': case 'replace': {
      const previousIds = new Set(before.map(row => row.text.split(':')[0]));
      const count = scenario.operation === 'replace' ? scenario.count
        : scenario.operation === 'create1k' ? 1000 : 10000;
      if (actual.length !== count || actual.some(row => row.className !== '') ||
          actual.some(row => previousIds.has(row.text.split(':')[0]))) {
        throw new Error(`${id}: failed ${scenario.name}`);
      }
      return;
    }
    case 'update': expected = before.map((row, index) => ({ ...row,
      text: row.text + (index % 10 === 0 ? ' !!!' : ''),
    })); break;
    case 'select': case 'transition': expected = before.map((row, index) => ({ ...row,
      className: index === (scenario.operation === 'select' ? 500 : 501) ? 'danger' : '',
    })); break;
    case 'swap': expected = [...before]; [expected[1], expected[998]] = [expected[998]!, expected[1]!]; break;
    case 'remove': expected = before.filter((_, index) => index !== 500); break;
    case 'pop1k': expected = before.slice(0, -1000); break;
    case 'reverse': expected = [...before].reverse(); break;
    case 'remove100': expected = before.filter((_, index) => index % 100 !== 0); break;
    case 'clear': expected = []; break;
    case 'append1k': case 'prepend1k': {
      if (actual.length !== before.length + 1000 || actual.some(row => row.className !== '')) {
        throw new Error(`${id}: failed ${scenario.name}`);
      }
      expected = before;
      const retained = scenario.operation === 'append1k' ? actual.slice(0, before.length) : actual.slice(1000);
      if (JSON.stringify(retained) !== JSON.stringify(expected)) throw new Error(`${id}: retained rows changed in ${scenario.name}`);
      return;
    }
    default: throw new Error(`Unknown operation ${scenario.operation}`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${id}: failed ${scenario.name}`);
}
function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}
export interface BenchRow { name: string; timings: Record<string, number> }
function runAll(): BenchRow[] {
  // Untimed correctness gates cover every operation and placement, not only selection.
  for (const { id, app } of adapters) {
    for (const scenario of scenarios) {
      console.info(`validate ${id}: ${scenario.name}`);
      setup(app, scenario);
      const before = snapshot(app);
      run(app, scenario);
      validate(id, app, scenario, before);
    }
    for (let warmup = 0; warmup < 3; warmup++) {
      operate(app, 'create1k'); operate(app, 'update'); app.selectRow(10); operate(app, 'clear');
    }
  }
  return scenarios.map((scenario, index) => {
    console.info(`measure ${scenario.name}`);
    const timings: Record<string, number> = {};
    const samples = new Map(adapters.map(({ id }) => [id, [] as number[]]));
    // Rotate adapter order to reduce a consistent first/last measurement bias.
    for (let sample = 0; sample < RUNS; sample++) {
      for (let offset = 0; offset < adapters.length; offset++) {
        const { id, app } = adapters[(index + sample + offset) % adapters.length]!;
        setup(app, scenario);
        const before = snapshot(app);
        const start = performance.now();
        run(app, scenario);
        samples.get(id)!.push(performance.now() - start);
        validate(id, app, scenario, before);
        operate(app, 'clear');
      }
    }
    for (const [id, values] of samples) timings[id] = median(values);
    return { name: scenario.name, timings };
  });
}
(window as unknown as Record<string, unknown>).__runAll = runAll;
