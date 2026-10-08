import { afterEach, beforeAll, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import {
  _internals, markDirty, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import {
  createMemoryRouteHistory, createRouteRuntime, setActiveRouteRuntime,
} from '@memoized-dom/router';

const fixtures: Record<string, Record<string, string>> = {};
for (const owner of ['module', 'instance']) {
  const state = `let seed = 2; let owned = seed * 2; let live = seed * 3;
    const label = owned + ':' + live;`;
  fixtures[owner] = { './App.tsx': `
    ${owner === 'module' ? state : ''}
    ${owner === 'module' ? 'function Display() { return <output>{label}</output>; }' : ''}
    export function App() { ${owner === 'instance' ? state : ''}
      return <main>${owner === 'module' ? '<Display/><Display/>' : '<output>{label}</output>'}
        <button id="own" onClick={() => owned++}>own</button>
        <button id="source" onClick={() => seed++}>source</button>
        <button id="both" onClick={() => { seed++; owned = 30; }}>both</button>
      </main>;
    }` };
}
fixtures.rows = { './App.tsx': `
  function Row({story}) {
    let points = story.points ?? 0;
    let sourcePoints = story.points ?? 0;
    const title = story.title;
    const label = points + ':' + sourcePoints + ':' + title;
    function upvote() { points++; }
    return <li data-id={story.id}><button onClick={upvote}>{label}</button></li>;
  }
  export function App() {
    let stories = [{id:1,points:3,title:'one'}, {id:2,points:7,title:'two'}];
    return <main><button id="source" onClick={() => {
      stories = stories.map(story => ({...story,points:story.points+10,title:story.title+'!'}));
    }}>source</button><button id="reverse" onClick={() => stories = [...stories].reverse()}>reverse</button>
      <ul>{stories.map(story => <Row key={story.id} story={story}/>)}</ul>
    </main>;
  }` };
fixtures.patterns = { './App.tsx': `export function App() {
  let seed = {points:3,extra:10};
  let {points, extra} = seed;
  let [score] = [seed.points * 2];
  let {points: live} = seed;
  const label = points + ':' + extra + ':' + score + ':' + live;
  return <main><output>{label}</output>
    <button id="own" onClick={() => { points++; score++; }}>own</button>
    <button id="source" onClick={() => seed = {points:20,extra:30}}>source</button>
  </main>;
}` };
fixtures.wizard = {
  './seed.ts': `export const INITIAL = {name:'start',count:0};`,
  './App.tsx': `import {INITIAL} from './seed';
    function Editor({onChange}) { return <button id="edit" onClick={() => onChange('edited')}>edit</button>; }
    export function App() {
      let state = {...INITIAL};
      const summary = state.name + ':' + state.count;
      function update(name) { state = {...state,name,count:state.count+1}; }
      return <main><output>{summary}</output><Editor onChange={update}/>
        <button id="reset" onClick={() => state = {...INITIAL}}>reset</button>
        <p>{INITIAL.name}:{INITIAL.count}</p>
      </main>;
    }`,
};
fixtures.subscription = { './App.tsx': `
  import {route} from '@memoized-dom/router';
  import {subscribeRoute} from '@memoized-dom/router/internal';
  export function App() {
    let currentPath = route.pathname;
    const label = 'path=' + currentPath;
    $effect(() => subscribeRoute(snapshot => { currentPath = snapshot.pathname; }));
    return <main><output>{label}</output>
      <button id="own" onClick={() => currentPath = '/local'}>local</button>
    </main>;
  }` };
fixtures.setup = { './App.tsx': `export function App() {
  let seed = 1;
  let owned = seed++;
  const label = seed + ':' + owned;
  return <main><output>{label}</output>
    <button id="own" onClick={() => owned++}>own</button>
    <button id="source" onClick={() => seed++}>source</button>
  </main>;
}` };
fixtures.linked = {
  './state.ts': `export let seed = 2; export let owned = seed * 2; export let live = seed * 3;
    export const label = owned + ':' + live;
    export function incrementOwned() { owned++; }
    export function incrementSeed() { seed++; }`,
  './App.tsx': `import {label,incrementOwned,incrementSeed} from './state';
    function Display() { return <output>{label}</output>; }
    export function App() { return <main><Display/><Display/>
      <button id="own" onClick={incrementOwned}>own</button>
      <button id="source" onClick={incrementSeed}>source</button>
    </main>; }`,
};
for (const owner of ['module', 'instance']) {
  const state = 'let source = [1]; let visible = source.filter(Boolean); const total = visible.length;';
  fixtures[`collection-${owner}`] = { './App.tsx': `
    ${owner === 'module' ? state : ''}
    export function App() { ${owner === 'instance' ? state : ''}
      return <main><output>{total}</output>
        <button id="own" onClick={() => visible.push(3)}>own</button>
        <button id="source" onClick={() => source.push(2)}>source</button>
      </main>;
    }` };
}

beforeAll(() => {
  const directory = join(import.meta.dirname, 'fixtures/out/writable-initializers');
  for (const [name, modules] of Object.entries(fixtures)) for (const deferred of [false, true]) {
    const target = join(directory, `${name}-${deferred}`);
    mkdirSync(target, {recursive:true});
    for (const [id, output] of Object.entries(compileModules(modules))) {
      writeFileSync(join(target, id.replace(/\.tsx$/, '.ts')), output);
    }
  }
});

afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); resetAccessTable(); document.body.replaceChildren();
});

async function mount(name: string, deferred: boolean, twice = false) {
  const pending: Array<() => void> = [];
  setScheduler(run => { if (deferred) pending.push(run); else run(); });
  const specifier = `./fixtures/out/writable-initializers/${name}-${deferred}/App.ts`;
  const {App} = await import(specifier);
  document.body.append(App('App', null));
  if (twice) document.body.append(App('Other', null));
  const flush = () => { while (pending.length) pending.shift()!(); };
  const click = (selector: string) => { document.querySelector<HTMLButtonElement>(selector)!.click(); flush(); };
  flush();
  return {flush, click, value: () => document.querySelector('output')!.textContent};
}

for (const owner of ['module', 'instance']) it.each([false,true])(
  `${owner}: preserves authored state and refreshes unwritten derivations (deferred=%s)`, async deferred => {
    const app = await mount(owner, deferred, owner === 'instance');
    const values = () => [...document.querySelectorAll('output')].map(node => node.textContent);
    expect(values()).toEqual(['4:6','4:6']);
    app.click('#own'); expect(values()).toEqual(owner === 'module' ? ['5:6','5:6'] : ['5:6','4:6']);
    app.click('#source'); expect(app.value()).toBe('5:9');
    app.click('#both'); expect(app.value()).toBe('30:12');
    markDirty('App'); app.flush(); expect(app.value()).toBe('30:12');
  },
);

it.each([false,true])('keeps row-owned votes across prop replacement and reorder (deferred=%s)', async deferred => {
  const app = await mount('rows', deferred, true);
  const list = document.querySelector('ul')!;
  const rows = [...list.children];
  app.click('li button'); app.click('li button');
  expect(rows[0]!.textContent).toBe('5:3:one');
  expect(document.querySelectorAll('ul')[1]!.textContent).toBe('3:3:one7:7:two');
  app.click('#source');
  expect(rows[0]!.textContent).toBe('5:13:one!');
  expect(rows[1]!.textContent).toBe('7:17:two!');
  app.click('#reverse');
  expect([...list.children]).toEqual([rows[1],rows[0]]);
  app.click('li button'); expect(rows[1]!.textContent).toBe('8:17:two!');
  markDirty('App'); app.flush(); expect(rows[0]!.textContent).toBe('5:13:one!');
});

it.each([false,true])('tracks written pattern bindings without replaying their initializer (deferred=%s)', async deferred => {
  const app = await mount('patterns', deferred);
  expect(app.value()).toBe('3:10:6:3');
  app.click('#own'); expect(app.value()).toBe('4:10:7:3');
  app.click('#source'); expect(app.value()).toBe('4:10:7:20');
  markDirty('App'); app.flush(); expect(app.value()).toBe('4:10:7:20');
});

it.each([false,true])('updates imported initial-state copies through child callbacks and reset (deferred=%s)', async deferred => {
  const app = await mount('wizard', deferred, true);
  app.click('#edit'); app.click('#edit'); expect(app.value()).toBe('edited:2');
  expect(document.querySelectorAll('output')[1]!.textContent).toBe('start:0');
  expect(document.querySelector('p')!.textContent).toBe('start:0');
  app.click('#reset'); expect(app.value()).toBe('start:0');
});

it.each([false,true])('publishes subscription writes and preserves a local override until the next navigation (deferred=%s)', async deferred => {
  const router = createRouteRuntime({routeHistory:createMemoryRouteHistory()});
  const previous = setActiveRouteRuntime(router);
  const disconnect = router.connect();
  try {
    const app = await mount('subscription', deferred);
    expect(app.value()).toBe('path=/');
    router.navigate('/next'); app.flush(); expect(app.value()).toBe('path=/next');
    app.click('#own'); expect(app.value()).toBe('path=/local');
    markDirty('App'); app.flush(); expect(app.value()).toBe('path=/local');
    router.navigate('/last'); app.flush(); expect(app.value()).toBe('path=/last');
  } finally {
    _internals().registry.forEach((_, id) => unregister(id));
    disconnect(); router.dispose(); setActiveRouteRuntime(previous);
  }
});

it.each([false,true])('executes an owned initializer with writes only once (deferred=%s)', async deferred => {
  const app = await mount('setup', deferred);
  expect(app.value()).toBe('2:1');
  app.click('#own'); expect(app.value()).toBe('2:2');
  app.click('#source'); expect(app.value()).toBe('3:2');
  markDirty('App'); app.flush(); expect(app.value()).toBe('3:2');
});

it.each([false,true])('links writable setup and unwritten derivations across module helpers (deferred=%s)', async deferred => {
  const app = await mount('linked', deferred);
  const values = () => [...document.querySelectorAll('output')].map(node => node.textContent);
  expect(values()).toEqual(['4:6','4:6']);
  app.click('#own'); expect(values()).toEqual(['5:6','5:6']);
  app.click('#source'); expect(values()).toEqual(['5:9','5:9']);
  markDirty('App'); app.flush(); expect(values()).toEqual(['5:9','5:9']);
});

for (const owner of ['module','instance']) it.each([false,true])(
  `${owner}: publishes mutations to a collection initialized from another collection (deferred=%s)`, async deferred => {
    const app = await mount(`collection-${owner}`, deferred);
    expect(app.value()).toBe('1');
    app.click('#own'); expect(app.value()).toBe('2');
    app.click('#source'); expect(app.value()).toBe('2');
    markDirty('App'); app.flush(); expect(app.value()).toBe('2');
  },
);
