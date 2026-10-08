import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModules } from '@memoized-dom/compiler';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/published-forwarding');
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  const compiled = compileModules({
    './row.tsx': `export function Row(props) {
      return <li data-id={props.item.id} class={props.active ? 'selected' : ''} onClick={() => props.select(props.item.id)}>{props.item.label}</li>;
    }`,
    './app.tsx': `import { Row } from './row';
      export function App() {
        let items = [{id: 1, label: 'one'}, {id: 2, label: 'two'}, {id: 3, label: 'three'}];
        let selected = null;
        const apply = id => { selected = id; };
        const forward = id => { return apply(id); };
        const select = id => forward(id);
        return <main><ul>{items.map(item => <Row key={item.id} item={item} active={selected === item.id} select={select}/>)}</ul></main>;
      }`,
  });
  writeFileSync(join(directory, 'row.ts'), compiled['./row.tsx']!);
  writeFileSync(join(directory, 'app.ts'), compiled['./app.tsx']!);
});
beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  document.body.innerHTML = '';
});
afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetScheduler(); vi.restoreAllMocks();
});

it.each([false, true])('forwarded selection publishes once and preserves nodes (deferred=%s)', async deferred => {
  const pending: Array<() => void> = [];
  let schedules = 0;
  setScheduler(fn => { schedules++; if (deferred) pending.push(fn); else fn(); });
  const specifier = './fixtures/out/published-forwarding/app.ts';
  const { App } = await import(specifier);
  document.body.append(App('App', null));
  const rows = [...document.querySelectorAll<HTMLLIElement>('li')];
  const render = vi.spyOn(_internals().registry.get('App')!, 'render');
  for (const index of [0, 1, 1, 2, 0]) {
    schedules = 0; render.mockClear();
    rows[index]!.click();
    while (pending.length) pending.shift()!();
    expect([...document.querySelectorAll('li')]).toEqual(rows);
    expect(rows.map(row => row.className)).toEqual(rows.map((_, rowIndex) => rowIndex === index ? 'selected' : ''));
    expect(rows.map(row => row.textContent)).toEqual(['one', 'two', 'three']);
    expect(schedules).toBe(1); expect(render).toHaveBeenCalledTimes(1);
  }
});
