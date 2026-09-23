import { describe, expect, it } from 'vitest';
import {
  createRouteRuntime,
  redirectRoute,
  registerRouteComponent,
  registerRoutedPreparation,
} from '@memoized-dom/router/internal';

describe('lazy route preparation', () => {
  it('keeps the current route committed until its module is ready', async () => {
    const key = './LazyReady.tsx#LazyReady';
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    const runtime = createRouteRuntime({
      environment: { location: { href: 'http://localhost/' } as Location },
      routes: [
        { id: 'home', pattern: '/' },
        { id: 'detail', pattern: '/detail', metadata: {
          componentKey: key,
          moduleLoader: async () => {
            await loading;
            registerRouteComponent(key, () => null);
          },
        } },
      ],
    });
    try {
      const result = runtime.navigate('/detail');
      expect(result.status).toBe('preparing');
      expect(runtime.route.pathname).toBe('/');
      release();
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await expect(result.finished).resolves.toMatchObject({ status: 'completed' });
      expect(runtime.route.pathname).toBe('/detail');
    } finally {
      runtime.dispose();
    }
  });

  it('leaves the current route in place when the chunk fails', async () => {
    const key = './LazyFailure.tsx#LazyFailure';
    const runtime = createRouteRuntime({
      environment: { location: { href: 'http://localhost/' } as Location },
      routes: [
        { id: 'home', pattern: '/' },
        { id: 'detail', pattern: '/detail', metadata: {
          componentKey: key,
          moduleLoader: async () => { throw new Error('chunk unavailable'); },
        } },
      ],
    });
    try {
      const result = runtime.navigate('/detail');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await expect(result.finished).rejects.toThrow('chunk unavailable');
      expect(runtime.route.pathname).toBe('/');
    } finally {
      runtime.dispose();
    }
  });

  it('runs a parent preparation before fetching its child module', async () => {
    const gate = './ParentGate.tsx#routed:Parent:0';
    let childLoads = 0;
    registerRoutedPreparation({
      id: gate,
      server: false,
      prepare: () => redirectRoute('/'),
    });
    const runtime = createRouteRuntime({
      environment: { location: { href: 'http://localhost/' } as Location },
      routes: [
        { id: 'home', pattern: '/' },
        { id: 'parent', pattern: '/parent', metadata: { preparations: [gate] } },
        { id: 'child', parentId: 'parent', pattern: '/child', metadata: {
          componentKey: './ChildGate.tsx#Child',
          moduleLoader: async () => { childLoads++; },
        } },
      ],
    });
    try {
      const result = runtime.navigate('/parent/child');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await result.finished;
      expect(childLoads).toBe(0);
      expect(runtime.route.pathname).toBe('/');
    } finally {
      runtime.dispose();
    }
  });
});
