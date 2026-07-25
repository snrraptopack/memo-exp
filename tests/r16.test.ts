/**
 * R16 exercises compiler-wide identifier hygiene against adversarial source
 * bindings, including nested rows, conditions, computeds, and timer callbacks.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '../compiler/compile';
import { resetAccessTable } from '../src/access';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '../src/kernel';

const source = `
  const _MD = 'module';
  const _WRITES_ = 'writes';
  let count = 0;
  let items = [{ id: 1, label: 'one' }];
  const doubled = count * 2;

  function Row(item) {
    const _rowId = 'user-row';
    const _entry = 'user-entry';
    return <li>{item.label}:{doubled}:{_rowId}:{_entry}</li>;
  }

  export function App(id, parent, update) {
    const _id = 'user-id';
    const _parent = 'user-parent';
    const _props = 'user-props';
    const _update = 'user-update';
    const _value = 'user-value';
    const _slot = 'user-slot';
    const _text = 'user-text';
    const _button = 'user-button';
    const _region = 'user-region';
    const _when = 'user-when';
    const _nextProp = 'user-next';
    const _returnValue = 'user-return';
    const text0 = 'old-text';
    const region0 = 'old-region';
    const WRITES_0 = 'old-writes';
    const $t = 'old-temp';
    const $s0 = 'old-slot';
    const label = [id, parent, update, _id, _parent, _props, _update,
      _value, _slot, _text, _button, _region, _when, _nextProp,
      _returnValue, text0, region0, WRITES_0, $t, $s0].join('|');
    const later = () => setTimeout(() => count++, 0);

    return <div>
      <button onClick={() => count++}>sync</button>
      <button onClick={later}>later</button>
      <span>{label}:{count}:{_MD}:{_WRITES_}</span>
      {count > 0 ? <b>on</b> : <i>off</i>}
      <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>
    </div>;
  }
`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r16-hygiene.compiled.ts';
  return import(specifier);
}

describe('R16 - compiler-wide identifier hygiene', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r16-hygiene.compiled.ts'),
      compile(source, { runtimePath: '../out-runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetScheduler();
  });

  it('allocates compiler bindings away from every user binding', () => {
    const code = compile(source, { runtimePath: '../out-runtime' });
    expect(code).toMatch(/import \* as _MD\d+ from/);
    expect(code).not.toContain('const count = Row(');
    expect(code).toMatch(/function App\(_id\d+, _parent\d+, _props\d+\)/);
    expect(code).toMatch(/const _update\d+ = \(\) =>/);
    expect(code).toMatch(/const _region\d+ = _MD\d+\.createListRegion/);
    expect(code).toMatch(/const _when\d+ = _MD\d+\.createCondRegion/);
  });

  it('mounts and updates through sync and timer callbacks', async () => {
    const mod = await importCompiled();
    document.body.appendChild(mod.App('App', null, ['I', 'P', 'U']));

    const buttons = document.querySelectorAll('button');
    expect(document.querySelector('i')?.textContent).toBe('off');
    expect(document.querySelector('span')?.textContent).toContain(':0:module:writes');

    (buttons[0] as HTMLElement).click();
    expect(document.querySelector('b')?.textContent).toBe('on');
    expect(document.querySelector('span')?.textContent).toContain(':1:module:writes');

    (buttons[1] as HTMLElement).click();
    vi.runAllTimers();
    expect(document.querySelector('span')?.textContent).toContain(':2:module:writes');
  });
});
