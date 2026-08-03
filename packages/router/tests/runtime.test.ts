import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteRuntime, supportsNavigationAPI } from '../src/internal';
import type {
  NavigationController,
  NavigationEventLike,
  RouteEnvironment,
} from '../src/internal';

function browserEnvironment(): RouteEnvironment {
  return {
    location: window.location,
    history: window.history,
    addEventListener: (type, listener) =>
      window.addEventListener(type, listener),
    removeEventListener: (type, listener) =>
      window.removeEventListener(type, listener),
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('route runtime', () => {
  it('uses the Navigation API as the primary navigation boundary', () => {
    let listener: EventListener | null = null;
    const intercept = vi.fn();
    const navigation: NavigationController = {
      addEventListener: vi.fn((_type, next) => { listener = next; }),
      removeEventListener: vi.fn((_type, current) => {
        if (listener === current) listener = null;
      }),
      navigate: vi.fn((href, options) => {
        const event = Object.assign(new Event('navigate'), {
          canIntercept: true,
          destination: {
            url: href,
            getState: () => options?.state,
          },
          downloadRequest: null,
          hashChange: false,
          navigationType: options?.history === 'replace' ? 'replace' : 'push',
          intercept,
        }) as NavigationEventLike;
        listener?.(event);
      }),
      back: vi.fn(),
      forward: vi.fn(),
    };
    const historyPush = vi.spyOn(window.history, 'pushState');
    const runtime = createRouteRuntime({
      location: window.location,
      history: window.history,
      navigation,
    });
    const disconnect = runtime.connect();

    expect(supportsNavigationAPI({ navigation })).toBe(true);
    runtime.navigate('/docs/:section', {
      params: { section: 'compiler' },
      state: { via: 'navigation-api' },
    });

    expect(navigation.navigate).toHaveBeenCalledWith(
      'http://localhost:3000/docs/compiler',
      { history: 'push', state: { via: 'navigation-api' } },
    );
    expect(runtime.route.pathname).toBe('/docs/compiler');
    expect(runtime.route.state).toEqual({ via: 'navigation-api' });
    expect(intercept).toHaveBeenCalledOnce();
    expect(historyPush).not.toHaveBeenCalled();

    disconnect();
    runtime.dispose();
  });

  it('observes ordinary same-origin navigation through the Navigation API', () => {
    let listener: EventListener | null = null;
    const intercept = vi.fn();
    const navigation: NavigationController = {
      addEventListener: (_type, next) => { listener = next; },
      removeEventListener: () => { listener = null; },
      navigate: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    };
    const runtime = createRouteRuntime({
      location: window.location,
      history: window.history,
      navigation,
    });
    runtime.connect();

    (listener as EventListener | null)?.(Object.assign(new Event('navigate'), {
      canIntercept: true,
      destination: { url: 'http://localhost:3000/from-anchor' },
      downloadRequest: null,
      hashChange: false,
      navigationType: 'push',
      intercept,
    }) as NavigationEventLike);

    expect(runtime.route.pathname).toBe('/from-anchor');
    expect(intercept).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('exposes stable getter-backed location state', () => {
    window.history.replaceState({ from: 'test' }, '', '/docs?tab=api#intro');
    const runtime = createRouteRuntime(browserEnvironment());
    const identity = runtime.route;

    expect(runtime.route.pathname).toBe('/docs');
    expect(runtime.route.query.get('tab')).toBe('api');
    expect(runtime.route.hash).toBe('#intro');
    expect(runtime.route.state).toEqual({ from: 'test' });

    runtime.setLocation('/settings');
    expect(runtime.route).toBe(identity);
    expect(runtime.route.pathname).toBe('/settings');
    runtime.dispose();
  });

  it('pushes and replaces browser entries with structured destinations', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');

    runtime.navigate('/organizations/:organizationId', {
      params: { organizationId: 'acme' },
      query: { tab: 'members' },
      state: { source: 'test' },
    });
    expect(runtime.route.pathname).toBe('/organizations/acme');
    expect(runtime.route.query.get('tab')).toBe('members');
    expect(runtime.route.navigationType).toBe('push');
    expect(runtime.route.state).toEqual({ source: 'test' });
    expect(push).toHaveBeenCalledOnce();

    runtime.navigate('/login', { replace: true });
    expect(runtime.route.pathname).toBe('/login');
    expect(runtime.route.navigationType).toBe('replace');
    expect(replace).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('aborts the previous location boundary on navigation', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const previous = runtime.route.signal;

    runtime.navigate('/next');

    expect(previous.aborted).toBe(true);
    expect(runtime.route.signal).not.toBe(previous);
    expect(runtime.route.signal.aborted).toBe(false);
    runtime.dispose();
  });

  it('publishes an active nested match chain and merged parameters atomically', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.setMatches([
      {
        id: 'Organization',
        pattern: '/organizations/:organizationId',
        pathname: '/organizations/acme',
        params: { organizationId: 'acme' },
      },
      {
        id: 'Project',
        pattern: '/projects/:projectId',
        pathname: '/organizations/acme/projects/compiler',
        params: { projectId: 'compiler' },
      },
    ]);

    expect(runtime.route.params).toEqual({
      organizationId: 'acme',
      projectId: 'compiler',
    });
    expect(runtime.route.matched?.id).toBe('Project');
    expect(runtime.route.matches).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2);

    runtime.setMatches(runtime.route.matches);
    expect(listener).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('tracks back/forward changes only while connected', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const listener = vi.fn();
    runtime.subscribe(listener);
    const disconnect = runtime.connect();

    window.history.pushState({ traversed: true }, '', '/from-browser');
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { traversed: true },
    }));
    expect(runtime.route.pathname).toBe('/from-browser');
    expect(runtime.route.navigationType).toBe('pop');

    disconnect();
    window.history.pushState(null, '', '/after-disconnect');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(runtime.route.pathname).toBe('/from-browser');
    runtime.dispose();
  });

  it('does not install duplicate browser listeners for nested owners', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const runtime = createRouteRuntime({
      location: window.location,
      history: window.history,
      addEventListener: add,
      removeEventListener: remove,
    });

    const first = runtime.connect();
    const second = runtime.connect();
    expect(add).toHaveBeenCalledTimes(2);

    first();
    expect(remove).not.toHaveBeenCalled();
    second();
    expect(remove).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
});
