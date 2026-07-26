import { describe, it, expect, beforeEach } from 'vitest';
import {
  setScheduler,
  resetScheduler,
  markDirty,
  unregister,
  _internals,
} from '@memoized-dom/runtime/testing';
import { Counter } from '../examples/counter';

describe('M0 kernel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('mounts, registers, and re-renders via dirty → commit', () => {
    setScheduler((fn) => fn()); // synchronous commit

    const root = Counter('App/Counter');
    document.body.appendChild(root);

    expect(document.body.textContent).toBe('count: 0');
    expect(_internals().registry.has('App/Counter')).toBe(true);

    root.click();
    expect(document.body.textContent).toBe('count: 1');

    root.click();
    root.click();
    expect(document.body.textContent).toBe('count: 3');

    resetScheduler();
  });

  it('dedupes many dirty marks into a single render per frame', () => {
    let pump: (() => void) | null = null;
    setScheduler((fn) => {
      pump = fn; // manual frame pump: commit only when we say so
    });

    const root = Counter('App/Counter');
    document.body.appendChild(root);

    // spy on the registered update branch
    const entity = _internals().registry.get('App/Counter')!;
    let renders = 0;
    const original = entity.render;
    entity.render = () => {
      renders++;
      original();
    };

    root.click();
    root.click();
    root.click(); // 3 events, 3 dirty marks...

    expect(renders).toBe(0); // ...nothing rendered yet (batched)
    pump!(); // one frame
    expect(renders).toBe(1); // ...one render total
    expect(document.body.textContent).toBe('count: 3'); // final state correct

    resetScheduler();
  });

  it('dead letters: marking an unmounted entity is a silent no-op', () => {
    setScheduler((fn) => fn());

    const root = Counter('App/Counter');
    document.body.appendChild(root);
    unregister('App/Counter');

    expect(() => markDirty('App/Counter')).not.toThrow();
    expect(_internals().dirtySet.size).toBe(0);

    resetScheduler();
  });

  it('value-cached setter: DOM untouched when value is unchanged', () => {
    setScheduler((fn) => fn());

    const root = Counter('App/Counter');
    document.body.appendChild(root);

    const textNode = root.childNodes[1] as Text;
    let writes = 0;
    const originalData = Object.getOwnPropertyDescriptor(
      CharacterData.prototype,
      'data',
    )!.set!;
    Object.defineProperty(CharacterData.prototype, 'data', {
      set(v) {
        writes++;
        originalData.call(this, v);
      },
    });

    markDirty('App/Counter'); // dirty, but count is still 0
    expect(writes).toBe(0); // update branch ran, setter guard skipped the write

    root.click();
    expect(writes).toBe(1); // only the real change touches the DOM

    resetScheduler();
  });
});
