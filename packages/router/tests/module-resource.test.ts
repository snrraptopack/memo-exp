import { describe, expect, it, vi } from 'vitest';
import {
  createRouteRuntime,
  readRouteComponent,
  readRouteModuleState,
  registerRouteComponent,
  subscribeRouteModuleState,
} from '../src/internal';

describe('route module resource', () => {
  it('notifies a ready resource when HMR replaces its component factory', () => {
    const key = './ModuleResourceHot.tsx#Hot';
    const updates: string[] = [];
    const unsubscribe = subscribeRouteModuleState(key, state => updates.push(state.status));
    try {
      const first = () => 'first';
      const second = () => 'second';
      registerRouteComponent(key, first);
      registerRouteComponent(key, second);
      expect(readRouteComponent(key)).toBe(second);
      expect(updates).toEqual(['ready', 'ready']);
    } finally {
      unsubscribe();
    }
  });

  it('publishes loading and ready only after the module finishes evaluating', async () => {
    const key = './ModuleResourceReady.tsx#Ready';
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    const phases: string[] = [];
    const unsubscribe = subscribeRouteModuleState(key, state => phases.push(state.status));
    const runtime = createRouteRuntime({
      environment: {},
      routes: [{ id: 'ready', pattern: '/ready', metadata: {
        componentKey: key,
        moduleLoader: async () => {
          registerRouteComponent(key, () => null);
          await loading;
        },
      } }],
    });
    try {
      expect(readRouteModuleState(key).status).toBe('idle');
      const result = runtime.navigate('/ready');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await vi.waitFor(() => expect(readRouteModuleState(key).status).toBe('loading'));
      expect(phases).toEqual(['loading']);
      release();
      await result.finished;
      expect(readRouteModuleState(key)).toMatchObject({ status: 'ready', error: null });
      expect(phases).toEqual(['loading', 'ready']);
    } finally {
      unsubscribe();
      runtime.dispose();
    }
  });

  it('deduplicates a shared import without treating early registration as ready', async () => {
    const key = './ModuleResourceShared.tsx#Shared';
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    const loader = vi.fn(async () => {
      registerRouteComponent(key, () => null);
      await loading;
    });
    const create = () => createRouteRuntime({
      environment: {},
      routes: [{ id: 'shared', pattern: '/shared', metadata: {
        componentKey: key,
        moduleLoader: loader,
      } }],
    });
    const firstRuntime = create();
    const secondRuntime = create();
    try {
      const first = firstRuntime.navigate('/shared');
      if (first.status !== 'preparing') throw new Error('Expected preparation');
      await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
      const second = secondRuntime.navigate('/shared');
      if (second.status !== 'preparing') throw new Error('Expected preparation');
      expect(secondRuntime.route.pathname).toBe('/');
      release();
      await Promise.all([first.finished, second.finished]);
      expect(loader).toHaveBeenCalledOnce();
      expect(firstRuntime.route.pathname).toBe('/shared');
      expect(secondRuntime.route.pathname).toBe('/shared');
    } finally {
      firstRuntime.dispose();
      secondRuntime.dispose();
    }
  });

  it('stores a chunk error and retries on the next navigation', async () => {
    const key = './ModuleResourceRetry.tsx#Retry';
    const failure = new Error('chunk unavailable');
    let attempts = 0;
    let retry: (() => unknown) | undefined;
    const runtime = createRouteRuntime({
      environment: {},
      routes: [{ id: 'retry', pattern: '/retry', metadata: {
        componentKey: key,
        moduleLoader: async () => {
          attempts++;
          if (attempts === 1) {
            registerRouteComponent(key, () => 'partial');
            throw failure;
          }
          registerRouteComponent(key, () => null);
        },
      } }],
    });
    const unsubscribe = runtime.subscribeNavigation(event => {
      if (event.phase === 'error') retry = event.retry;
    });
    try {
      const first = runtime.navigate('/retry');
      if (first.status !== 'preparing') throw new Error('Expected preparation');
      await expect(first.finished).rejects.toBe(failure);
      expect(readRouteModuleState(key)).toMatchObject({ status: 'error', error: failure });
      expect(() => readRouteComponent(key)).toThrow('mounted before loading');
      expect(runtime.route.pathname).toBe('/');
      expect(retry).toBeTypeOf('function');

      const second = retry!() as ReturnType<typeof runtime.navigate>;
      if (second.status !== 'preparing') throw new Error('Expected retry preparation');
      await expect(second.finished).resolves.toMatchObject({ status: 'completed' });
      expect(attempts).toBe(2);
      expect(readRouteModuleState(key).status).toBe('ready');
      expect(runtime.route.pathname).toBe('/retry');
    } finally {
      unsubscribe();
      runtime.dispose();
    }
  });

  it('treats a fulfilled loader without the expected component as an error', async () => {
    const key = './ModuleResourceMissing.tsx#Missing';
    const runtime = createRouteRuntime({
      environment: {},
      routes: [{ id: 'missing', pattern: '/missing', metadata: {
        componentKey: key,
        moduleLoader: async () => {},
      } }],
    });
    try {
      const result = runtime.navigate('/missing');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await expect(result.finished).rejects.toThrow('did not register');
      expect(readRouteModuleState(key).status).toBe('error');
      expect(runtime.route.pathname).toBe('/');
    } finally {
      runtime.dispose();
    }
  });

  it('cancels a superseded wait while the shared chunk continues loading', async () => {
    const key = './ModuleResourceSuperseded.tsx#Slow';
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    const loader = vi.fn(async () => {
      await loading;
      registerRouteComponent(key, () => null);
    });
    const runtime = createRouteRuntime({
      environment: {},
      routes: [
        { id: 'slow', pattern: '/slow', metadata: { componentKey: key, moduleLoader: loader } },
        { id: 'newer', pattern: '/newer' },
      ],
    });
    try {
      const slow = runtime.navigate('/slow');
      if (slow.status !== 'preparing') throw new Error('Expected preparation');
      const canceled = expect(slow.finished).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
      expect(runtime.navigate('/newer').status).toBe('completed');
      await canceled;
      expect(runtime.route.pathname).toBe('/newer');
      expect(readRouteModuleState(key).status).toBe('loading');

      release();
      await vi.waitFor(() => expect(readRouteModuleState(key).status).toBe('ready'));
      const revisit = runtime.navigate('/slow');
      if (revisit.status === 'preparing') await revisit.finished;
      expect(runtime.route.pathname).toBe('/slow');
      expect(loader).toHaveBeenCalledOnce();
    } finally {
      runtime.dispose();
    }
  });
});
