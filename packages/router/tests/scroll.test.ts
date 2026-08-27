import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrollCoordinator } from '../src/scroll';
import { createRouteRuntime } from '../src/runtime';

describe('scroll restoration coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('records scroll position and restores it on pop navigation', async () => {
    let scrollX = 0;
    let scrollY = 0;
    const scrollTo = vi.fn((x: number, y: number) => {
      scrollX = x;
      scrollY = y;
    });

    const mockWindow = {
      get scrollX() { return scrollX; },
      get scrollY() { return scrollY; },
      scrollTo,
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const coordinator = createScrollCoordinator({ window: mockWindow });
    const disconnect = coordinator.connect();

    // 1. Initial page (Key 1) at (0, 0)
    coordinator.restore(new URL('http://localhost/page1'), 'load', 'key_1');

    // 2. User scrolls down to (0, 1420)
    scrollX = 0;
    scrollY = 1420;
    coordinator.capture('key_1');

    // 3. Navigate to Page 2 (Push) -> resets scroll to (0, 0)
    coordinator.restore(new URL('http://localhost/page2'), 'push', 'key_2');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    // 4. Navigate back to Page 1 (Pop) -> restores (0, 1420)
    coordinator.restore(new URL('http://localhost/page1'), 'pop', 'key_1');
    expect(scrollTo).toHaveBeenCalledWith(0, 1420);

    disconnect();
    coordinator.dispose();
  });

  it('scrolls hash targets into view with fallback retry', () => {
    const scrollIntoView = vi.fn();
    const mockElement = { scrollIntoView } as unknown as Element;

    const mockDoc = {
      getElementById: vi.fn((id: string) => (id === 'faq' ? mockElement : null)),
      querySelector: vi.fn(() => null),
    } as unknown as Document;

    const mockWindow = {
      scrollX: 0,
      scrollY: 0,
      scrollTo: vi.fn(),
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const coordinator = createScrollCoordinator({
      window: mockWindow,
      document: mockDoc,
    });

    // Hash navigation (push to /docs#faq)
    coordinator.restore(new URL('http://localhost/docs#faq'), 'push', 'key_faq');
    expect(mockDoc.getElementById).toHaveBeenCalledWith('faq');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

    coordinator.dispose();
  });

  it('integrates transparently with createRouteRuntime with zero state pollution', () => {
    const stateHistory: Array<{ state: unknown; url: string }> = [];
    const mockHistory = {
      scrollRestoration: 'auto' as ScrollRestoration,
      get state() {
        return stateHistory.at(-1)?.state ?? null;
      },
      pushState: vi.fn((state: unknown, _title: string, url: string) => {
        stateHistory.push({ state, url });
      }),
      replaceState: vi.fn((state: unknown, _title: string, url: string) => {
        if (stateHistory.length === 0) stateHistory.push({ state, url });
        else stateHistory[stateHistory.length - 1] = { state, url };
      }),
    } as unknown as History;

    const mockWindow = {
      scrollX: 0,
      scrollY: 0,
      scrollTo: vi.fn(),
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      history: mockHistory,
      location: { href: 'http://localhost/' },
    } as unknown as Window;

    const runtime = createRouteRuntime({
      location: mockWindow.location as unknown as Location,
      history: mockHistory,
    });

    const disconnect = runtime.connect();

    // ScrollRestoration set to manual automatically
    expect(mockHistory.scrollRestoration).toBe('manual');

    // 1. Navigate with custom object state
    runtime.navigate('/settings', { state: { tab: 'security', filter: 'active' } });

    // User-facing route.state is pure and clean (zero __mmd_key leakage)
    expect(runtime.route.state).toEqual({ tab: 'security', filter: 'active' });

    // 2. Navigate with primitive state
    runtime.navigate('/count', { state: 42 });
    expect(runtime.route.state).toBe(42);

    disconnect();
    runtime.dispose();
  });
});
