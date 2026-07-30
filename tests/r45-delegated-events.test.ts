/** R45 - root-scoped delegated events for repeated compiler-owned DOM. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDelegatedEvent } from '@memoized-dom/runtime/testing';

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

    setDelegatedEvent(root, first, 'onClick', function () {
      calls.push(this);
    });
    setDelegatedEvent(root, second, 'onClick', function () {
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

    setDelegatedEvent(outer, outerRow, 'onClick', () => calls.push('outer'));
    setDelegatedEvent(inner, button, 'onClick', () => calls.push('inner'));
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

    setDelegatedEvent(root, input, 'onFocus', () => {
      focused = true;
    });
    setDelegatedEvent(
      root,
      link,
      'onClick',
      (() => false) as unknown as EventListener,
    );

    input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    const allowed = link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(focused).toBe(true);
    expect(allowed).toBe(false);
  });
});
