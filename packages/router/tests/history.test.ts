import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryRouteHistory,
  createRouteRuntime,
} from '../src';

describe('memory route history', () => {
  it('starts at the requested entry with stable navigation capabilities', () => {
    const history = createMemoryRouteHistory({
      origin: 'https://example.test',
      initialEntries: [
        '/',
        { href: '/projects', state: { source: 'initial' } },
        '/settings',
      ],
      initialIndex: 1,
    });

    expect(history.location.href).toBe('https://example.test/projects');
    expect(history.location.state).toEqual({ source: 'initial' });
    expect(history.location.index).toBe(1);
    expect(history.canGoBack).toBe(true);
    expect(history.canGoForward).toBe(true);
    expect(Object.isFrozen(history.location)).toBe(true);
  });

  it('pushes, replaces, traverses, and truncates a forward stack', () => {
    const history = createMemoryRouteHistory({ initialEntries: ['/', '/first'] });
    const received: string[] = [];
    history.subscribe(update => {
      received.push(`${update.action}:${new URL(update.location.href).pathname}`);
    });

    const retainedKey = history.location.key;
    history.replace('/renamed', { replaced: true });
    expect(history.location.key).toBe(retainedKey);
    expect(history.location.state).toEqual({ replaced: true });

    history.push('/second');
    history.back();
    expect(history.location.href.endsWith('/renamed')).toBe(true);
    expect(history.canGoForward).toBe(true);

    history.push('/branch');
    expect(history.location.href.endsWith('/branch')).toBe(true);
    expect(history.canGoForward).toBe(false);
    history.forward();
    expect(history.location.href.endsWith('/branch')).toBe(true);

    expect(received).toEqual([
      'replace:/renamed',
      'push:/second',
      'pop:/renamed',
      'push:/branch',
    ]);
  });

  it('rolls storage back when a synchronous subscriber rejects an update', () => {
    const history = createMemoryRouteHistory({ initialEntries: ['/stable'] });
    history.subscribe(() => {
      throw new Error('reject history update');
    });

    expect(() => history.push('/broken')).toThrow('reject history update');
    expect(history.location.href.endsWith('/stable')).toBe(true);
    expect(history.location.index).toBe(0);
  });

  it('rejects invalid construction, traversal, and post-destroy operations', () => {
    expect(() => createMemoryRouteHistory({ initialEntries: [] })).toThrow('at least one');
    expect(() => createMemoryRouteHistory({
      initialEntries: ['/'],
      initialIndex: 2,
    })).toThrow('outside');

    const history = createMemoryRouteHistory();
    expect(() => history.go(0.5)).toThrow('integer');
    history.destroy();
    expect(() => history.push('/next')).toThrow('destroyed');
    expect(() => history.subscribe(vi.fn())).toThrow('destroyed');
  });
});

describe('route runtime history storage', () => {
  it('uses an explicit route history as its URL and traversal authority', () => {
    const history = createMemoryRouteHistory({
      initialEntries: ['/', { href: '/posts/1', state: { initial: true } }],
    });
    const runtime = createRouteRuntime({
      routeHistory: history,
      routes: [
        { id: 'home', pattern: '/' },
        { id: 'post', pattern: '/posts/:id' },
      ],
    });

    expect(runtime.route.pathname).toBe('/posts/1');
    expect(runtime.route.state).toEqual({ initial: true });
    expect(runtime.route.params.id).toBe('1');

    runtime.navigate('/posts/:id', {
      params: { id: '2' },
      state: { pushed: true },
    });
    expect(runtime.route.pathname).toBe('/posts/2');
    expect(runtime.route.navigationType).toBe('push');
    expect(history.location.state).toEqual({ pushed: true });

    runtime.back();
    expect(runtime.route.pathname).toBe('/posts/1');
    expect(runtime.route.navigationType).toBe('pop');
    runtime.forward();
    expect(runtime.route.pathname).toBe('/posts/2');

    runtime.dispose();
    history.back();
    expect(runtime.route.pathname).toBe('/posts/2');
  });

  it('keeps committed runtime and history state aligned when an observer fails', () => {
    const history = createMemoryRouteHistory();
    const runtime = createRouteRuntime({ routeHistory: history });
    runtime.subscribe(snapshot => {
      if (snapshot.pathname === '/committed') throw new Error('observer failed');
    });

    expect(() => runtime.navigate('/committed')).toThrow('observer failed');
    expect(runtime.route.pathname).toBe('/committed');
    expect(new URL(history.location.href).pathname).toBe('/committed');
    runtime.dispose();
    history.destroy();
  });
});
