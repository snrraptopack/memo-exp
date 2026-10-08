import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrollCoordinator } from '../src/scroll';
import { createRouteRuntime } from '../src/runtime-full';
import { createMemoryRouteHistory } from '../src/history';

describe('scroll restoration coordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function deferredFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id);
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    return {
      request, cancel, scrollTo,
      flush() {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(0);
      },
    };
  }

  it('cancels an obsolete restore when another destination replaces it', () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/old'), 'push', 'old');
    coordinator.restore(new URL('http://localhost/new'), 'replace', 'new');
    frames.flush();
    expect(frames.cancel).toHaveBeenCalled();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('waits for destination readiness and ignores a superseded readiness signal', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    let ready!: () => void;
    const promise = new Promise<void>(resolve => { ready = resolve; });
    coordinator.restore(new URL('http://localhost/slow'), 'push', 'slow', promise);
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.restore(new URL('http://localhost/new'), 'replace', 'new');
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('restores only after the readiness signal resolves', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    let ready!: () => void;
    coordinator.restore(new URL('http://localhost/ready'), 'push', 'ready',
      new Promise<void>(resolve => { ready = resolve; }));
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 0);
    coordinator.dispose();
  });

  it('does not restore a destination whose readiness fails', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/failed'), 'push', 'failed',
      Promise.reject(new Error('failed mount')));
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('does not overwrite a saved destination offset with old DOM scroll while awaiting readiness', async () => {
    const frames = deferredFrames();
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(10);
    sessionStorage.setItem('__mmd_scroll_waiting', JSON.stringify({ x: 0, y: 750 }));
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    let ready!: () => void;
    coordinator.restore(new URL('http://localhost/waiting'), 'pop', 'waiting',
      new Promise<void>(resolve => { ready = resolve; }));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('pagehide'));
    coordinator.capture('waiting');
    frames.flush();
    ready();
    await Promise.resolve();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 750);
    coordinator.dispose();
  });

  it('keeps scroll tracking in memory and persists only when the entry is left or hidden', () => {
    const frames = deferredFrames();
    const position = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    coordinator.restore(new URL('http://localhost/feed'), 'load', 'feed');
    for (let index = 0; index < 5; index++) {
      window.dispatchEvent(new Event('scroll'));
      frames.flush();
    }
    expect(setItem).not.toHaveBeenCalled();

    position.mockReturnValue(450);
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(sessionStorage.getItem('__mmd_scroll_feed')!)).toEqual({ x: 0, y: 450 });

    position.mockReturnValue(500);
    coordinator.capture('feed');
    expect(JSON.parse(sessionStorage.getItem('__mmd_scroll_feed')!)).toEqual({ x: 0, y: 500 });
    coordinator.dispose();
  });

  it('bounds persisted positions in session storage', () => {
    deferredFrames();
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(10);
    const coordinator = createScrollCoordinator();
    for (let index = 0; index < 105; index++) coordinator.capture(`entry-${index}`);
    const stored = Object.keys(sessionStorage).filter(key => key.startsWith('__mmd_scroll_'));
    expect(stored).toHaveLength(100);
    expect(sessionStorage.getItem('__mmd_scroll_entry-0')).toBeNull();
    expect(sessionStorage.getItem('__mmd_scroll_entry-104')).not.toBeNull();
    coordinator.dispose();

    const reloaded = createScrollCoordinator();
    reloaded.capture('entry-105');
    expect(sessionStorage.getItem('__mmd_scroll_entry-5')).toBeNull();
    expect(Object.keys(sessionStorage).filter(key => key.startsWith('__mmd_scroll_'))).toHaveLength(100);
    reloaded.dispose();
  });

  it('keeps load and replace positions unchanged when there is no hash', () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/load'), 'load', 'load');
    coordinator.restore(new URL('http://localhost/replace'), 'replace', 'replace');
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('cancels a delayed hash observer when another navigation wins', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/old#old-target'), 'push', 'old-target');
    frames.flush();
    coordinator.restore(new URL('http://localhost/new'), 'push', 'new');
    frames.flush();
    const target = document.createElement('h2');
    target.id = 'old-target';
    const intoView = vi.spyOn(target, 'scrollIntoView');
    document.body.append(target);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(intoView).not.toHaveBeenCalled();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 0);
    coordinator.dispose();
  });

  it('prefers saved history position over the URL hash on back/forward', () => {
    const frames = deferredFrames();
    const target = document.createElement('h2');
    target.id = 'saved';
    document.body.append(target);
    const intoView = vi.spyOn(target, 'scrollIntoView');
    sessionStorage.setItem('__mmd_scroll_saved', JSON.stringify({ x: 12, y: 820 }));
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/docs#saved'), 'pop', 'saved');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(12, 820);
    expect(intoView).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('finds a hash target inserted after more than two frames', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/docs#late'), 'push', 'late');
    frames.flush();
    frames.flush();
    frames.flush();
    const target = document.createElement('h2');
    target.id = 'late';
    const intoView = vi.spyOn(target, 'scrollIntoView');
    document.body.append(target);
    await vi.waitFor(() => expect(intoView).toHaveBeenCalledTimes(1));
    coordinator.dispose();
  });

  it('cancels delayed hash discovery when the user starts scrolling', async () => {
    const frames = deferredFrames();
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    coordinator.restore(new URL('http://localhost/docs#cancelled'), 'push', 'cancelled');
    frames.flush();
    window.dispatchEvent(new WheelEvent('wheel'));
    const target = document.createElement('h2');
    target.id = 'cancelled';
    const intoView = vi.spyOn(target, 'scrollIntoView');
    document.body.append(target);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(intoView).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('handles malformed percent escapes and named anchors without CSS.escape', () => {
    const frames = deferredFrames();
    const target = document.createElement('a');
    target.setAttribute('name', '%broken');
    document.body.append(target);
    const intoView = vi.spyOn(target, 'scrollIntoView');
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/docs#%broken'), 'push', 'broken');
    expect(() => frames.flush()).not.toThrow();
    expect(intoView).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('ignores invalid stored coordinates and falls back to the top', () => {
    const frames = deferredFrames();
    sessionStorage.setItem('__mmd_scroll_invalid', '{"x":null,"y":"820"}');
    const coordinator = createScrollCoordinator();
    coordinator.restore(new URL('http://localhost/invalid'), 'pop', 'invalid');
    frames.flush();
    expect(frames.scrollTo).toHaveBeenCalledWith(0, 0);
    coordinator.dispose();
  });

  it('dispose releases listeners, cancels queued work and restores browser policy', () => {
    const frames = deferredFrames();
    const previous = history.scrollRestoration;
    const remove = vi.spyOn(window, 'removeEventListener');
    const coordinator = createScrollCoordinator();
    coordinator.connect();
    coordinator.restore(new URL('http://localhost/disposed'), 'push', 'disposed');
    coordinator.dispose();
    frames.flush();
    expect(frames.scrollTo).not.toHaveBeenCalled();
    expect(history.scrollRestoration).toBe(previous);
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('uses memory history entry keys for back/forward scroll snapshots', () => {
    const frames = deferredFrames();
    const position = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    const history = createMemoryRouteHistory({ initialEntries: ['/first'] });
    const firstKey = history.location.key;
    const runtime = createRouteRuntime({ routeHistory: history, environment: {} });
    runtime.connect();
    runtime.navigate('/second');
    frames.flush();
    expect(JSON.parse(sessionStorage.getItem(`__mmd_scroll_${firstKey}`)!)).toEqual({ x: 0, y: 640 });
    position.mockReturnValue(210);
    const secondKey = history.location.key;
    runtime.back();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 640);
    expect(JSON.parse(sessionStorage.getItem(`__mmd_scroll_${secondKey}`)!)).toEqual({ x: 0, y: 210 });
    runtime.forward();
    frames.flush();
    expect(frames.scrollTo).toHaveBeenLastCalledWith(0, 210);
    runtime.dispose();
    history.destroy();
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
