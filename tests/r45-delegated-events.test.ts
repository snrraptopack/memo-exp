/** R45 - root-scoped delegated events for repeated compiler-owned DOM. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDelegatedEventBinding,
  setDelegatedEvent,
} from '@memoized-dom/runtime/testing';
import { compileModules } from '@memoized-dom/compiler';

describe('R45 - delegated event runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('installs one root listener pair and dispatches with DOM this', () => {
    const root = document.createElement('div');
    const first = document.createElement('button');
    const second = document.createElement('button');
    root.append(first, second);
    document.body.appendChild(root);
    const add = vi.spyOn(root, 'addEventListener');
    const calls: EventTarget[] = [];

    const click = createDelegatedEventBinding(root, 'onClick');
    setDelegatedEvent(click, first, function () {
      calls.push(this);
    });
    setDelegatedEvent(click, second, function () {
      calls.push(this);
    });

    first.click();
    second.click();
    expect(calls).toEqual([first, second]);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('keeps nested roots independent', () => {
    const outer = document.createElement('section');
    const outerRow = document.createElement('article');
    const inner = document.createElement('div');
    const button = document.createElement('button');
    inner.appendChild(button);
    outerRow.appendChild(inner);
    outer.appendChild(outerRow);
    document.body.appendChild(outer);
    const calls: string[] = [];

    const outerClick = createDelegatedEventBinding(outer, 'onClick');
    const innerClick = createDelegatedEventBinding(inner, 'onClick');
    setDelegatedEvent(outerClick, outerRow, () => calls.push('outer'));
    setDelegatedEvent(innerClick, button, () => calls.push('inner'));
    button.click();

    expect(calls).toEqual(['inner', 'outer']);
  });

  it('captures non-bubbling events and preserves return-false default prevention', () => {
    const root = document.createElement('div');
    const input = document.createElement('input');
    const link = document.createElement('a');
    link.href = '#target';
    root.append(input, link);
    document.body.appendChild(root);
    let focused = false;

    const focus = createDelegatedEventBinding(root, 'onFocus');
    const click = createDelegatedEventBinding(root, 'onClick');
    setDelegatedEvent(focus, input, () => {
      focused = true;
    });
    setDelegatedEvent(
      click,
      link,
      (() => false) as unknown as EventListener,
    );

    input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    const allowed = link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(focused).toBe(true);
    expect(allowed).toBe(false);
  });

  it('links exact prebound event names across component modules', () => {
    const output = compileModules({
      './Row.tsx': `
        export function Row({ item }) {
          return <li onClick={() => item.clicked++} onFocus={() => item.focused++}>{item.id}</li>;
        }
      `,
      './App.tsx': `
        import { Row } from './Row';
        export function App() {
          let items = [{ id: 1, clicked: 0, focused: 0 }];
          return <ul>{items.map(item => <Row key={item.id} item={item} />)}</ul>;
        }
      `,
    });

    expect(
      output['./App.tsx'].match(/\.createDelegatedEventBinding\(/g),
    ).toHaveLength(2);
    expect(output['./App.tsx']).toContain('"onClick"');
    expect(output['./App.tsx']).toContain('"onFocus"');
    expect(output['./Row.tsx'].match(/\.setDelegatedEvent\(/g)).toHaveLength(2);
    expect(output['./Row.tsx']).not.toContain('"onClick"');
    expect(output['./Row.tsx']).not.toContain('"onFocus"');
  });
});
