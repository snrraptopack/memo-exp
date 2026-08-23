/**
 * Phase 0 — hydration-safe keyed-list identity encoding.
 *
 * Contract under test (packages/runtime/src/list-keys.ts):
 *   - type-tagged primitive encoding (`n:` `s:` `g:` `t` `f`) so 1 / "1" /
 *     1n / true never collapse into one row identity;
 *   - percent-escaped string keys so `/`, `]`, `%` and friends cannot break
 *     the `<prefix>/Row[...]` id/marker structure;
 *   - exact round-trips through decodeListKey;
 *   - declared limitation: non-primitive keys stay process-local synthetics.
 */
import { describe, expect, it } from 'vitest';
import {
  createListRegion,
  decodeListKey,
  encodeListKey,
  register,
} from '@memoized-dom/runtime';
import { _internals } from '@memoized-dom/runtime/testing';

function makeRegion<T>(key: (item: T) => unknown) {
  const parent = document.createElement('ul');
  document.body.appendChild(parent);
  const region = createListRegion<T>(
    parent,
    'App/L',
    (item, id) => {
      register({ id, parent: null, render: () => {} });
      const li = document.createElement('li');
      li.textContent = String(item);
      return { nodes: li, update: () => {}, entities: [id] };
    },
    key as (item: T, index: number) => unknown,
  );
  return { region, parent };
}


describe('hydration-safe list key encoding', () => {
  it('tags every primitive type distinctly', () => {
    expect(encodeListKey(1)).toBe('n:1');
    expect(encodeListKey('1')).toBe('s:1');
    expect(encodeListKey(1n)).toBe('g:1');
    expect(encodeListKey(true)).toBe('t');
    expect(encodeListKey(false)).toBe('f');
    // No two of these ever share an encoded form:
    const encodings = [1, '1', 1n, true, 'true', 0, 'n:1'].map((key) =>
      encodeListKey(key),
    );
    expect(new Set(encodings).size).toBe(encodings.length);
  });

  it('escapes protocol-significant characters in string keys', () => {
    for (const unsafe of [
      'a/b',
      'x]y',
      '[x',
      '100%',
      'a:b',
      'has space',
      'line\nbreak',
      'emoji-🚀',
      '',
    ]) {
      const encoded = encodeListKey(unsafe)!;
      expect(encoded.startsWith('s:')).toBe(true);
      const segment = encoded.slice(2);
      // The escaped segment can never inject id structure.
      expect(segment).not.toContain('/');
      expect(segment).not.toContain(']');
      expect(segment).not.toContain('[');
      expect(decodeListKey(encoded)).toBe(unsafe);
    }
  });

  it('round-trips edge-case numbers exactly', () => {
    for (const value of [0, -0, 1.5, -273.15, 1e21, Infinity, -Infinity]) {
      const encoded = encodeListKey(value)!;
      expect(encoded.startsWith('n:')).toBe(true);
      const decoded = decodeListKey(encoded) as number;
      // SameValueZero equivalence: -0 and 0 are the same key.
      expect(Object.is(decoded, value) || decoded === value).toBe(true);
    }
    // NaN is not a stable identity (it has no canonical literal form).
    expect(encodeListKey(NaN)).toBeNull();
  });

  it('round-trips bigints and rejects malformed input', () => {
    expect(decodeListKey(encodeListKey(-42n)!)).toBe(-42n);
    expect(decodeListKey(encodeListKey(BigInt('12345678901234567890123'))!)).toBe(
      BigInt('12345678901234567890123'),
    );
    expect(decodeListKey('#3')).toBeUndefined(); // legacy synthetic
    expect(decodeListKey('n:')).toBeUndefined();
    expect(decodeListKey('n:abc')).toBeUndefined();
    expect(decodeListKey('g:1.5')).toBeUndefined();
    expect(decodeListKey('s:%zz')).toBeUndefined();
  });

  it('declares non-primitive keys as process-local synthetics', () => {
    expect(encodeListKey({ id: 1 })).toBeNull();
    expect(encodeListKey(Symbol('k'))).toBeNull();
    expect(encodeListKey(null)).toBeNull();
    expect(encodeListKey(undefined)).toBeNull();
  });

  it('renders distinct rows for colliding-under-String() keys', () => {
    const { region, parent } = makeRegion<string | number | bigint | boolean>(
      (item) => item,
    );
    try {
      region.reconcile(['1', 1, '1n', true] as unknown as (string | number | bigint | boolean)[]);
      // All four rows exist and are distinct entities.
      expect(parent.querySelectorAll('li').length).toBe(4);
    } finally {
      region.dispose();
      document.body.replaceChildren();
    }
  });

  it('keeps retained-row identity across reorder with mixed key types', () => {
    const parent = document.createElement('ul');
    document.body.appendChild(parent);

    const region = createListRegion<string>(
      parent,
      'App/Mixed',
      (item, id) => {
        register({ id, parent: null, render: () => {} });
        const li = document.createElement('li');
        li.dataset.row = item;
        return { nodes: li, update: () => {}, entities: [id] };
      },
      (item) => (item === 'num' ? 7 : item),
    );

    try {
      region.reconcile(['num', 'str']);
      const numId = 'App/Mixed/Row[n:7]';
      const strId = 'App/Mixed/Row[s:str]';
      expect(_internals().registry.has(numId)).toBe(true);
      expect(_internals().registry.has(strId)).toBe(true);

      // Spy on the retained number-keyed row's update closure.
      let numRenders = 0;
      const numEntity = _internals().registry.get(numId)!;
      const originalRender = numEntity.render;
      numEntity.render = () => {
        numRenders++;
        originalRender();
      };

      // Reorder: both rows retain identity and do not re-render.
      region.reconcile(['str', 'num']);
      expect(numRenders).toBe(0);
      const first = parent.querySelector('li')!;
      expect(first.dataset.row).toBe('str');
    } finally {
      region.dispose();
      document.body.replaceChildren();
    }
  });
});
