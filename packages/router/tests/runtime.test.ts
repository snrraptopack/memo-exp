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
  vi.restoreAllMocks();
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
    expect(intercept).toHaveBeenCalledWith(expect.objectContaining({
      scroll: 'after-transition',
    }));
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

  it('does not intercept ineligible Navigation API events and handles hashes natively', () => {
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
    const dispatch = (overrides: Partial<NavigationEventLike>) => {
      (listener as EventListener | null)?.(Object.assign(new Event('navigate'), {
        canIntercept: true,
        destination: { url: 'http://localhost:3000/next' },
        downloadRequest: null,
        hashChange: false,
        navigationType: 'push',
        intercept,
        ...overrides,
      }) as NavigationEventLike);
    };

    dispatch({ canIntercept: false });
    dispatch({ destination: { url: 'https://example.com/external' } });
    dispatch({ downloadRequest: '' });
    expect(runtime.route.pathname).toBe('/');
    expect(intercept).not.toHaveBeenCalled();

    dispatch({
      destination: { url: 'http://localhost:3000/#section' },
      hashChange: true,
    });
    expect(runtime.route.hash).toBe('#section');
    expect(intercept).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('does not apply the pre-connection fallback after an ineligible navigate event', () => {
    let listener: EventListener | null = null;
    const navigation: NavigationController = {
      addEventListener: (_type, next) => { listener = next; },
      removeEventListener: () => { listener = null; },
      navigate: vi.fn(href => {
        (listener as EventListener | null)?.(Object.assign(new Event('navigate'), {
          canIntercept: false,
          destination: { url: href },
          downloadRequest: null,
          hashChange: false,
          navigationType: 'push',
          intercept: vi.fn(),
        }) as NavigationEventLike);
      }),
      back: vi.fn(),
      forward: vi.fn(),
    };
    const runtime = createRouteRuntime({
      location: window.location,
      history: window.history,
      navigation,
    });
    runtime.connect();

    runtime.navigate('/browser-owned');

    expect(runtime.route.pathname).toBe('/');
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
    expect(Object.isFrozen(runtime.route.query)).toBe(true);
    expect(runtime.route.query).not.toHaveProperty('set');

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

  it('keeps state-only Navigation API changes before connection', () => {
    const navigation: NavigationController = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      navigate: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    };
    const runtime = createRouteRuntime({
      location: window.location,
      history: window.history,
      navigation,
    });

    runtime.navigate('/', { state: { changed: true } });

    expect(runtime.route.pathname).toBe('/');
    expect(runtime.route.state).toEqual({ changed: true });
    expect(runtime.route.navigationType).toBe('push');
    runtime.dispose();
  });

  it('intercepts eligible same-origin anchors in the history fallback', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const push = vi.spyOn(window.history, 'pushState');
    const disconnect = runtime.connect();
    const anchor = document.createElement('a');
    anchor.href = '/from-link?tab=router';
    anchor.textContent = 'Router';
    document.body.append(anchor);
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    anchor.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(runtime.route.pathname).toBe('/from-link');
    expect(runtime.route.query.get('tab')).toBe('router');
    expect(push).toHaveBeenCalledOnce();
    anchor.remove();
    disconnect();
    runtime.dispose();
  });

  it('leaves modified, external, download, target, and hash anchors to the browser', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    runtime.connect();
    const cases: Array<{ href: string; configure?: (anchor: HTMLAnchorElement) => void; ctrl?: boolean }> = [
      { href: '/modified', ctrl: true },
      { href: 'https://example.com/external' },
      { href: '/download', configure: anchor => anchor.setAttribute('download', '') },
      { href: '/new-tab', configure: anchor => { anchor.target = '_blank'; } },
      { href: '#section' },
    ];

    for (const testCase of cases) {
      const anchor = document.createElement('a');
      anchor.href = testCase.href;
      testCase.configure?.(anchor);
      document.body.append(anchor);
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: testCase.ctrl ?? false,
      });
      anchor.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
      anchor.remove();
    }

    expect(runtime.route.pathname).toBe('/');
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

  it('normalizes active route patterns before comparison', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.setMatches([{
      id: 'Docs',
      pattern: '/docs/',
      pathname: '/docs',
      params: {},
    }]);

    expect(runtime.route.matches[0]?.pattern).toBe('/docs');
    expect(listener).toHaveBeenCalledTimes(2);

    runtime.setMatches([{
      id: 'Docs',
      pattern: '/docs',
      pathname: '/docs',
      params: {},
    }]);

    expect(listener).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('resolves location and active matches in one subscriber notification', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const uninstall = runtime.installResolver(location => location.pathname === '/next'
      ? [{
        id: 'Next',
        pattern: '/next',
        pathname: '/next',
        params: {},
      }]
      : []);
    const received: string[] = [];
    runtime.subscribe(value => {
      received.push(`${value.pathname}:${value.matches.length}`);
    });

    runtime.setLocation('/next', 'push');

    expect(received).toEqual(['/:0', '/next:1']);
    expect(runtime.route.matched?.id).toBe('Next');
    expect(() => runtime.setMatches([])).toThrow('structural resolver');
    expect(() => runtime.installResolver(() => [])).toThrow('only have one');

    uninstall();
    expect(runtime.route.matches).toEqual([]);
    runtime.dispose();
  });

  it('rolls back a location transaction when its resolver fails', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const previousSignal = runtime.route.signal;
    runtime.installResolver(location => {
      if (location.pathname === '/broken') throw new Error('cannot resolve');
      return [];
    });

    expect(() => runtime.setLocation('/broken')).toThrow('cannot resolve');
    expect(runtime.route.pathname).toBe('/');
    expect(runtime.route.signal).toBe(previousSignal);
    expect(previousSignal.aborted).toBe(false);
    runtime.dispose();
  });

  it('requires structural resolvers to remain pure', () => {
    const runtime = createRouteRuntime(browserEnvironment());

    expect(() => runtime.installResolver(() => {
      runtime.setLocation('/reentrant');
      return [];
    })).toThrow('must not mutate router state');
    expect(runtime.route.pathname).toBe('/');

    const uninstall = runtime.installResolver(() => []);
    uninstall();
    runtime.dispose();
  });

  it('does not deliver a stale snapshot after a reentrant match publication', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const received: string[] = [];
    runtime.subscribe(value => {
      if (value.pathname === '/next' && value.matches.length === 0) {
        runtime.setMatches([{
          id: 'Next',
          pattern: '/next',
          pathname: '/next',
          params: {},
        }]);
      }
    });
    runtime.subscribe(value => {
      if (value.pathname === '/next') {
        received.push(`${value.pathname}:${value.matches.length}`);
      }
    });

    runtime.setLocation('/next');

    expect(received).toEqual(['/next:1']);
    runtime.dispose();
  });

  it('rejects duplicate IDs and parameter shadowing in an active chain', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    expect(() => runtime.setMatches([
      { id: 'Same', pattern: '/a', pathname: '/a', params: {} },
      { id: 'Same', pattern: '/b', pathname: '/a/b', params: {} },
    ])).toThrow("Duplicate active route ID 'Same'");
    expect(() => runtime.setMatches([
      { id: 'Parent', pattern: '/:id', pathname: '/a', params: { id: 'a' } },
      { id: 'Child', pattern: '/:id', pathname: '/a/b', params: { id: 'b' } },
    ])).toThrow("Duplicate active route parameter 'id'");
    expect(() => runtime.setMatches([
      { id: 'Broken', pattern: '/files/*/edit', pathname: '/files/a/edit', params: {} },
    ])).toThrow('must be terminal');
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
    expect(add).toHaveBeenCalledTimes(3);

    first();
    expect(remove).not.toHaveBeenCalled();
    second();
    expect(remove).toHaveBeenCalledTimes(3);
    runtime.dispose();
  });

  it('removes installed listeners if initial connection resolution fails', () => {
    const add = vi.fn((type: 'popstate' | 'hashchange' | 'click', listener: EventListener) =>
      window.addEventListener(type, listener));
    const remove = vi.fn((type: 'popstate' | 'hashchange' | 'click', listener: EventListener) =>
      window.removeEventListener(type, listener));
    const runtime = createRouteRuntime({
      location: window.location,
      history: window.history,
      addEventListener: add,
      removeEventListener: remove,
    });
    runtime.installResolver(location => {
      if (location.pathname === '/broken') throw new Error('cannot resolve');
      return [];
    });
    window.history.pushState(null, '', '/broken');

    expect(() => runtime.connect()).toThrow('cannot resolve');
    expect(add).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
    runtime.dispose();
  });

  it('isolates separately created runtimes for SSR and multiple roots', () => {
    const first = createRouteRuntime();
    const second = createRouteRuntime();

    first.setLocation('https://example.test/first');
    second.setLocation('https://example.test/second');

    expect(first.route.pathname).toBe('/first');
    expect(second.route.pathname).toBe('/second');
    expect(first.route.signal).not.toBe(second.route.signal);
    first.dispose();
    second.dispose();
  });

  it('continues notifying listeners when one fails', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    const later = vi.fn();
    runtime.subscribe(value => {
      if (value.pathname === '/next') throw new Error('listener failed');
    });
    runtime.subscribe(later);

    expect(() => runtime.setLocation('/next')).toThrow('listener failed');
    expect(later).toHaveBeenLastCalledWith(expect.objectContaining({
      pathname: '/next',
    }));
    expect(runtime.route.pathname).toBe('/next');
    runtime.dispose();
  });

  it('rejects commands after disposal', () => {
    const runtime = createRouteRuntime(browserEnvironment());
    runtime.dispose();

    expect(() => runtime.connect()).toThrow('disposed');
    expect(() => runtime.subscribe(() => {})).toThrow('disposed');
    expect(() => runtime.installResolver(() => [])).toThrow('disposed');
    expect(() => runtime.navigate('/next')).toThrow('disposed');
    expect(() => runtime.setLocation('/next')).toThrow('disposed');
    expect(() => runtime.setMatches([])).toThrow('disposed');
    expect(() => runtime.back()).toThrow('disposed');
    expect(() => runtime.forward()).toThrow('disposed');
  });
});
