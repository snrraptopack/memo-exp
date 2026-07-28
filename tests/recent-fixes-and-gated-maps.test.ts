/**
 * Regression coverage for c1fb9989..f91fbd0 and the first nested structural
 * region extension: mapped lists gated by a conditional branch.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';
import {
  _internals,
  registeredIds,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function writeCompiled(name: string, source: string): void {
  writeFileSync(
    join(outDir, `${name}.compiled.ts`),
    compile(source, { runtimePath: '@memoized-dom/runtime' }),
  );
}

function importCompiled(name: string): Promise<any> {
  const specifier = `./fixtures/out/${name}.compiled.ts`;
  return import(specifier);
}

function importLinkedEffect(): Promise<any> {
  const specifier = './fixtures/out/recent-imported-effect.ts';
  return import(specifier);
}

function importLinkedGatedMap(): Promise<any> {
  const specifier = './fixtures/out/recent-gated-app.ts';
  return import(specifier);
}

beforeAll(() => {
  mkdirSync(outDir, { recursive: true });

  writeCompiled(
    'recent-callback-props',
    `
      function Child({ onInline, onNamed }) {
        return <section>
          <button id="inline" onClick={() => onInline()}>inline</button>
          <button id="named" onClick={() => onNamed()}>named</button>
          <button id="direct-prop" onClick={onInline}>direct</button>
        </section>;
      }

      function ObjectChild(props) {
        return <button id="object-prop" onClick={props.onFire}>object</button>;
      }

      export function App() {
        let inlineCount = 0;
        let namedCount = 0;
        let objectCount = 0;
        const incrementNamed = () => namedCount++;
        return <main>
          <Child
            onInline={() => inlineCount++}
            onNamed={incrementNamed}
          />
          <ObjectChild onFire={() => objectCount++} />
          <output id="inline-count">{inlineCount}</output>
          <output id="named-count">{namedCount}</output>
          <output id="object-count">{objectCount}</output>
        </main>;
      }
    `,
  );

  writeCompiled(
    'recent-derived-effect',
    `
      export function App() {
        let items = [{ id: 1 }];
        const parity = items.length % 2;

        effect(() => console.log("parity:" + parity));

        return <main>
          <button id="same" onClick={() => {
            items = [{ id: 2 }];
          }}>same parity</button>
          <button id="change" onClick={() => {
            items = [...items, { id: 3 }];
          }}>change parity</button>
        </main>;
      }
    `,
  );

  writeCompiled(
    'conditional-gated-maps',
    `
      function Row(item) {
        let clicks = 0;
        return <li class="component-row" onClick={() => clicks++}>
          {item.label}:{clicks}
        </li>;
      }

      export function App() {
        let show = true;
        let items = [
          { id: 1, label: "one" },
          { id: 2, label: "two" },
        ];

        return <main>
          <button id="toggle" onClick={() => show = !show}>toggle</button>
          <button id="add" onClick={() => {
            const id = items.length + 1;
            items = [...items, { id, label: "item-" + id }];
          }}>add</button>

          {show ? <ul id="inline-list">
            {items.map(item => <li key={item.id} class="inline-row">{item.label}</li>)}
          </ul> : <p id="inline-hidden">hidden</p>}

          {show && <ol id="component-list">
            {items.map(item => <Row key={item.id} item={item} />)}
          </ol>}
        </main>;
      }
    `,
  );

  writeCompiled(
    'conditional-component-branch',
    `
      function Panel(value) {
        let clicks = 0;
        return <>
          <button id="panel-click" onClick={() => clicks++}>panel</button>
          <output id="panel-value">{value}:{clicks}</output>
        </>;
      }

      export function App() {
        let active = true;
        let value = 0;
        return <main>
          <button id="panel-toggle" onClick={() => active = !active}>toggle</button>
          <button id="panel-increment" onClick={() => value++}>increment</button>
          {active ? <Panel value={value} /> : <p id="panel-hidden">hidden</p>}
        </main>;
      }
    `,
  );

  const linked = compileModules(
    {
      './recent-effect-lib.ts': `
        export function readExternal() {
          console.info("external read");
          return 7;
        }
      `,
      './recent-imported-effect.tsx': `
        import { readExternal } from './recent-effect-lib';

        export function App() {
          let count = 0;
          effect(() => {
            console.log("effect:" + count + ":" + readExternal());
          });
          return <button id="effect-count" onClick={() => count++}>{count}</button>;
        }
      `,
    },
    { runtimePath: '@memoized-dom/runtime' },
  );
  writeFileSync(
    join(outDir, 'recent-effect-lib.ts'),
    linked['./recent-effect-lib.ts']!,
  );
  writeFileSync(
    join(outDir, 'recent-imported-effect.ts'),
    linked['./recent-imported-effect.tsx']!,
  );

  const gatedGraph = compileModules(
    {
      './recent-gated-row.tsx': `
        export function MetricCard({ metric }) {
          return <li class="linked-metric">{metric.label}</li>;
        }
      `,
      './recent-system-logs.tsx': `
        export function SystemLogs({ metrics, onClear }) {
          let clears = 0;
          return <section class="linked-logs">
            logs:{metrics.length}:{clears}
            <button id="linked-clear" onClick={onClear}>clear</button>
          </section>;
        }
      `,
      './recent-gated-app.tsx': `
        import { MetricCard } from './recent-gated-row';
        import { SystemLogs } from './recent-system-logs';

        export function App() {
          let overview = true;
          let metrics = [{ id: 1, label: "latency" }];
          const clearMetrics = () => {
            metrics = [];
          };
          return <main>
            <button id="linked-toggle" onClick={() => overview = !overview}>toggle</button>
            <button id="linked-add" onClick={() => {
              metrics = [...metrics, {
                id: metrics.length + 1,
                label: "metric-" + (metrics.length + 1),
              }];
            }}>add</button>
            {overview ? <ul>
              {metrics.map(metric =>
                <MetricCard key={metric.id} metric={metric} />
              )}
            </ul> : <SystemLogs metrics={metrics} onClear={clearMetrics} />}
          </main>;
        }
      `,
    },
    { runtimePath: '@memoized-dom/runtime' },
  );
  writeFileSync(
    join(outDir, 'recent-gated-row.ts'),
    gatedGraph['./recent-gated-row.tsx']!,
  );
  writeFileSync(
    join(outDir, 'recent-gated-app.ts'),
    gatedGraph['./recent-gated-app.tsx']!,
  );
  writeFileSync(
    join(outDir, 'recent-system-logs.ts'),
    gatedGraph['./recent-system-logs.tsx']!,
  );
});

beforeEach(() => {
  document.body.innerHTML = '';
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
  setScheduler((run) => run());
});

afterEach(() => {
  resetScheduler();
  vi.restoreAllMocks();
});

describe('recent commit regressions', () => {
  it('invalidates parent-local state from inline and named callback props', async () => {
    const { App } = await importCompiled('recent-callback-props');
    document.body.appendChild(App('App', null));

    document.querySelector<HTMLButtonElement>('#inline')!.click();
    expect(document.querySelector('#inline-count')!.textContent).toBe('1');
    expect(document.querySelector('#named-count')!.textContent).toBe('0');

    document.querySelector<HTMLButtonElement>('#named')!.click();
    expect(document.querySelector('#inline-count')!.textContent).toBe('1');
    expect(document.querySelector('#named-count')!.textContent).toBe('1');

    document.querySelector<HTMLButtonElement>('#direct-prop')!.click();
    expect(document.querySelector('#inline-count')!.textContent).toBe('2');

    document.querySelector<HTMLButtonElement>('#object-prop')!.click();
    expect(document.querySelector('#object-count')!.textContent).toBe('1');
  });

  it('treats a direct unbounded imported effect call as consumption', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { App } = await importLinkedEffect();

    document.body.appendChild(App('App', null));
    expect(info).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith('effect:0:7');

    document.querySelector<HTMLButtonElement>('#effect-count')!.click();
    expect(document.querySelector('#effect-count')!.textContent).toBe('1');
    expect(info).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith('effect:1:7');
  });

  it('reruns a derived-value effect only when its observed value changes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { App } = await importCompiled('recent-derived-effect');
    document.body.appendChild(App('App', null));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith('parity:1');

    document.querySelector<HTMLButtonElement>('#same')!.click();
    expect(log).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLButtonElement>('#change')!.click();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith('parity:0');
  });
});

describe('conditional gated maps', () => {
  it('emits nested list identity and branch disposal', () => {
    const code = compile(
      `
        let show = true;
        let items = [{ id: 1 }];
        let selected = 0;
        function Row(item) {
          let n = 0;
          return <li>{item.id}:{n}:{selected}</li>;
        }
        export function App() {
          return <main>{show ? <ul>
            {items.map(item => <Row key={item.id} item={item} />)}
          </ul> : null}</main>;
        }
      `,
    );

    expect(code).toContain('.createCondRegion(');
    expect(code).toContain('.createListRegion(');
    expect(code).toMatch(/_id\d* \+ "\/when0" \+ "\/items"/);
    expect(code).toContain('dispose: () =>');
    expect(code).toContain('.dispose()');
    expect(code).toContain('"App/when0/items/Row[*]"');
  });

  it('updates local gates and sources, and unregisters rows on branch swaps', async () => {
    const { App } = await importCompiled('conditional-gated-maps');
    document.body.appendChild(App('App', null));

    expect(document.querySelectorAll('.inline-row')).toHaveLength(2);
    expect(document.querySelectorAll('.component-row')).toHaveLength(2);
    expect(registeredIds()).toEqual([
      'App',
      'App/when0',
      'App/when0/items/Row[1]',
      'App/when0/items/Row[2]',
      'App/when1',
      'App/when1/items/Row[1]',
      'App/when1/items/Row[2]',
    ]);

    document.querySelector<HTMLButtonElement>('#add')!.click();
    expect(document.querySelectorAll('.inline-row')).toHaveLength(3);
    expect(document.querySelectorAll('.component-row')).toHaveLength(3);

    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(document.querySelector('#inline-hidden')).not.toBeNull();
    expect(document.querySelector('#component-list')).toBeNull();
    expect(registeredIds()).toEqual([
      'App',
      'App/when0',
      'App/when1',
    ]);

    document.querySelector<HTMLButtonElement>('#add')!.click();
    document.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(document.querySelectorAll('.inline-row')).toHaveLength(4);
    expect(document.querySelectorAll('.component-row')).toHaveLength(4);
    expect(new Set(registeredIds()).size).toBe(registeredIds().length);
  });

  it('links imported component rows inside a conditional branch', async () => {
    const { App } = await importLinkedGatedMap();
    document.body.appendChild(App('App', null));

    expect(document.querySelectorAll('.linked-metric')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('#linked-add')!.click();
    expect(document.querySelectorAll('.linked-metric')).toHaveLength(2);

    document.querySelector<HTMLButtonElement>('#linked-toggle')!.click();
    expect(document.querySelectorAll('.linked-metric')).toHaveLength(0);
    expect(document.querySelector('.linked-logs')!.textContent).toContain(
      'logs:2:0',
    );
    document.querySelector<HTMLButtonElement>('#linked-clear')!.click();
    expect(document.querySelector('.linked-logs')!.textContent).toContain(
      'logs:0:0',
    );
  });
});

describe('conditional component branches', () => {
  it('updates props and unregisters a local fragment-root component on swaps', async () => {
    const { App } = await importCompiled('conditional-component-branch');
    document.body.appendChild(App('App', null));

    expect(document.querySelector('#panel-value')!.textContent).toBe('0:0');
    expect(registeredIds()).toEqual([
      'App',
      'App/when0',
      'App/when0/Panel',
    ]);

    document.querySelector<HTMLButtonElement>('#panel-increment')!.click();
    expect(document.querySelector('#panel-value')!.textContent).toBe('1:0');
    document.querySelector<HTMLButtonElement>('#panel-click')!.click();
    expect(document.querySelector('#panel-value')!.textContent).toBe('1:1');

    document.querySelector<HTMLButtonElement>('#panel-toggle')!.click();
    expect(document.querySelector('#panel-value')).toBeNull();
    expect(document.querySelector('#panel-hidden')).not.toBeNull();
    expect(registeredIds()).toEqual(['App', 'App/when0']);

    document.querySelector<HTMLButtonElement>('#panel-toggle')!.click();
    expect(document.querySelector('#panel-value')!.textContent).toBe('1:0');
    expect(registeredIds()).toEqual([
      'App',
      'App/when0',
      'App/when0/Panel',
    ]);
  });
});
