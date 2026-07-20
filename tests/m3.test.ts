import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setScheduler,
  resetScheduler,
  unregister,
  _internals,
} from '../src/kernel';
import { getEventLog, clearEventLog } from '../src/events';
import { SelectListApp, __resetSelectListState, type Item } from '../examples/select-list';

function items(): Item[] {
  return [
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
    { id: 3, label: 'three' },
  ];
}

/** Wrap every registered render to count invocations per entity id. */
function spyRenders(): Map<string, number> {
  const counts = new Map<string, number>();
  _internals().registry.forEach((entity, id) => {
    counts.set(id, 0);
    const orig = entity.render;
    entity.render = () => {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      orig();
    };
  });
  return counts;
}

describe('M3 origin-scoped commit via static access table', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    __resetSelectListState();
    clearEventLog();
    setScheduler((fn) => fn()); // synchronous commit
  });
  afterEach(() => resetScheduler());

  it('row click dirties exactly the readers of selectedId — nothing else', () => {
    const root = SelectListApp(items());
    document.body.appendChild(root);
    const counts = spyRenders();

    const rows = root.querySelectorAll('li');
    (rows[1] as HTMLElement).click();

    // correct output
    expect(root.querySelector('header')!.textContent).toBe('selected: 2');
    expect(rows[1]!.classList.contains('selected')).toBe(true);
    expect(rows[0]!.classList.contains('selected')).toBe(false);

    // readers of selectedId ran: all rows (over-approximation) + the badge
    expect(counts.get('App/Header/Badge')).toBe(1);
    expect(counts.get('App/SelectList/Row[1]')).toBe(1);
    expect(counts.get('App/SelectList/Row[2]')).toBe(1);
    expect(counts.get('App/SelectList/Row[3]')).toBe(1);

    // everything else: NOT EVEN AWAKENED
    expect(counts.get('App/Footer')).toBe(0);
    expect(counts.get('App/SelectList')).toBe(0);
    expect(counts.get('App')).toBe(0);
  });

  it('filter input dirties only the footer — badge and rows sleep through it', () => {
    const root = SelectListApp(items());
    document.body.appendChild(root);
    const counts = spyRenders();

    const input = root.querySelector('input')!;
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));

    expect(root.querySelector('footer')!.textContent).toContain('filter: abc');
    expect(counts.get('App/Footer')).toBe(1);

    expect(counts.get('App/Header/Badge')).toBe(0);
    expect(counts.get('App/SelectList/Row[1]')).toBe(0);
    expect(counts.get('App/SelectList/Row[2]')).toBe(0);
    expect(counts.get('App/SelectList/Row[3]')).toBe(0);
    expect(counts.get('App')).toBe(0);
  });

  it('opaque write falls back to a root-subtree commit (Imba equivalence)', () => {
    const root = SelectListApp(items());
    document.body.appendChild(root);
    const counts = spyRenders();

    const prefsBtn = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'prefs',
    ) as HTMLButtonElement;
    prefsBtn.click();

    // EVERY live entity rendered — the graceful-degradation guarantee
    for (const [id, n] of counts) {
      expect(n, `expected ${id} to render under root-subtree fallback`).toBeGreaterThan(0);
    }
  });

  it('event log records provenance: origin + static write-set', () => {
    const root = SelectListApp(items());
    document.body.appendChild(root);

    (root.querySelectorAll('li')[0] as HTMLElement).click();

    const log = getEventLog();
    expect(log.length).toBe(1);
    expect(log[0]).toMatchObject({
      origin: 'App/SelectList/Row[1]',
      writes: ['selectedId'],
    });
  });
});
