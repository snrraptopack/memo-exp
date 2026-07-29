/**
 * R32 - module-level effects are singleton post-render entities.
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
} from 'vitest';
import {
  compile,
  compileModules,
} from '@memoized-dom/compiler';
import {
  registerEffect,
} from '@memoized-dom/runtime';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const graphDir = join(here, 'fixtures', 'out', 'r32-graph');

const GRAPH = {
  './state.ts': `
    export let count = 0;
    export function increment() { count++; }
  `,
  './observer.ts': `
    import { count } from './state';
    export let observed = -1;
    effect(() => {
      observed = count * 10;
    });
  `,
  './app.tsx': `
    import { increment } from './state';
    import { observed } from './observer';
    export function App() {
      return <main>
        <button id="increment" onClick={() => increment()}>increment</button>
        <output id="observed">{observed}</output>
      </main>;
    }
  `,
};

function importGraphApp(): Promise<any> {
  const specifier = './fixtures/out/r32-graph/app.ts';
  return import(specifier);
}

describe('R32 - module effects', () => {
  beforeAll(() => {
    mkdirSync(graphDir, { recursive: true });
    const output = compileModules(GRAPH, {
      runtimePath: '@memoized-dom/runtime',
    });
    writeFileSync(join(graphDir, 'state.ts'), output['./state.ts']!);
    writeFileSync(join(graphDir, 'observer.ts'), output['./observer.ts']!);
    writeFileSync(join(graphDir, 'app.ts'), output['./app.tsx']!);
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('links imported state to a singleton effect and propagates its writes', async () => {
    const { App } = await importGraphApp();
    document.body.appendChild(App('App', null));
    expect(document.querySelector('#observed')?.textContent).toBe('0');

    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#observed')?.textContent).toBe('10');

    const moduleEffects = [..._internals().registry.keys()].filter((id) =>
      id.includes('/$module-effects/'),
    );
    expect(moduleEffects).toHaveLength(1);
  });

  it('emits canonical subscriptions and HMR cleanup', () => {
    const output = compileModules(GRAPH, {
      runtimePath: '@memoized-dom/runtime',
    });
    expect(output['./observer.ts']).toContain(
      '"./state.ts#count": ["App/$module-effects/.%2Fobserver.ts/0"]',
    );
    expect(output['./observer.ts']).toContain('import.meta.hot.dispose');
  });

  it('runs the previous teardown before replacing a stable singleton id', () => {
    const events: string[] = [];
    registerEffect('module-singleton', null, () => {
      events.push('first');
      return () => events.push('cleanup:first');
    });
    registerEffect('module-singleton', null, () => {
      events.push('second');
      return () => events.push('cleanup:second');
    });
    expect(events).toEqual(['first', 'cleanup:first', 'second']);
    unregister('module-singleton');
    expect(events).toEqual([
      'first',
      'cleanup:first',
      'second',
      'cleanup:second',
    ]);
  });

  it('keeps a zero-dependency module effect as one post-load run', () => {
    const code = compile(`
      effect(() => console.log("loaded"));
      export function App() { return <main />; }
    `);
    expect(code).toContain('.registerEffect(');
    expect(code).not.toContain('"readers"');
  });
});
