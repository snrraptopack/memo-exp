import { describe, it, expect, beforeEach } from 'vitest';
import {
  setScheduler,
  resetScheduler,
  unregister,
  _internals,
} from '@memoized-dom/runtime/testing';
import {
  computedChanged,
  setText,
  setClass,
  setAttr,
  setProp,
  setStyle,
  type SlotCache,
} from '@memoized-dom/runtime/testing';
import { ProfileCard } from './fixtures/hand-compiled/profile-card';

/** Count writes to a Text node's data by shadowing the accessor on the instance. */
function spyTextWrites(node: Text) {
  let writes = 0;
  let stored = '';
  Object.defineProperty(node, 'data', {
    get: () => stored,
    set: (v: string) => {
      writes++;
      stored = v;
    },
  });
  return { get writes() { return writes; }, get value() { return stored; } };
}

describe('M1 setter helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('setText: writes once, guards repeats, renders null as empty', () => {
    const $: SlotCache = {};
    const t = document.createTextNode('');
    const spy = spyTextWrites(t);

    setText($, 'k', t, 'a');
    setText($, 'k', t, 'a'); // same -> skipped
    setText($, 'k', t, 'b');
    setText($, 'k', t, null); // -> ''

    expect(spy.writes).toBe(3);
    expect(spy.value).toBe('');
  });

  it('setClass: toggles only when the condition changes', () => {
    const $: SlotCache = {};
    const el = document.createElement('div');

    let calls = 0;
    const list = el.classList as any;
    const orig = list.toggle.bind(list);
    list.toggle = (...args: unknown[]) => {
      calls++;
      return orig(...(args as [string, boolean?]));
    };

    setClass($, 'k', el, 'on', true);
    setClass($, 'k', el, 'on', true); // skipped
    setClass($, 'k', el, 'on', false);

    expect(calls).toBe(2);
    expect(el.classList.contains('on')).toBe(false);
  });

  it('setAttr: set / boolean-true / remove semantics', () => {
    const $: SlotCache = {};
    const el = document.createElement('div');

    setAttr($, 'a', el, 'title', 'hello');
    expect(el.getAttribute('title')).toBe('hello');

    setAttr($, 'b', el, 'hidden', true);
    expect(el.getAttribute('hidden')).toBe('');

    setAttr($, 'b', el, 'hidden', false);
    expect(el.hasAttribute('hidden')).toBe(false);

    setAttr($, 'a', el, 'title', null);
    expect(el.hasAttribute('title')).toBe(false);
  });

  it('setProp: writes the property, not an attribute', () => {
    const $: SlotCache = {};
    const input = document.createElement('input');

    setProp($, 'v', input, 'value', 'typed');
    setProp($, 'v', input, 'value', 'typed'); // skipped

    expect(input.value).toBe('typed');
    expect(input.hasAttribute('value')).toBe(false);
  });

  it('setStyle: set and remove', () => {
    const $: SlotCache = {};
    const el = document.createElement('div');

    setStyle($, 'c', el, 'color', 'red');
    expect(el.style.getPropertyValue('color')).toBe('red');

    setStyle($, 'c', el, 'color', null);
    expect(el.style.getPropertyValue('color')).toBe('');
  });

  it('computedChanged suppresses only safely comparable values', () => {
    expect(computedChanged(1, 1)).toBe(false);
    expect(computedChanged(Number.NaN, Number.NaN)).toBe(false);
    expect(computedChanged([1, 'a', null], [1, 'a', null])).toBe(false);

    const item = { id: 1 };
    expect(computedChanged([item], [item])).toBe(true);
    const sameArray = [1];
    expect(computedChanged(sameArray, sameArray)).toBe(true);
    expect(computedChanged(item, item)).toBe(true);
  });

  it('integration: ProfileCard mounts seeded and commits via helpers', () => {
    setScheduler((fn) => fn());

    const card = ProfileCard('App/ProfileCard', null, 'babyface');
    document.body.appendChild(card);

    // mount seed happened through the same update branch
    expect(card.querySelector('span')!.textContent).toBe('babyface');
    expect(card.getAttribute('data-status')).toBe('offline');
    expect(card.querySelector('input')!.value).toBe('babyface');

    // toggle online
    (card.querySelector('i') as HTMLElement).click();
    expect(card.getAttribute('data-status')).toBe('online');
    expect(card.querySelector('i')!.classList.contains('dot--on')).toBe(true);

    // type into the input
    const input = card.querySelector('input')!;
    input.value = 'theo';
    input.dispatchEvent(new Event('input'));
    expect(card.querySelector('span')!.textContent).toBe('theo');

    resetScheduler();
  });
});
