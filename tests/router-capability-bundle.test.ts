import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compileModules } from '@memoized-dom/compiler';
import { describe, expect, it, vi } from 'vitest';
import type { RouteRuntime } from '../packages/router/src/runtime';

describe('bundled public router construction', () => {
  for (const graph of ['source', 'package'] as const) {
    it(`retains lazy preparation and failure recovery through the ${graph} constructor alone`, async () => {
      const result = await build({
        stdin: { contents: `export {createRouteRuntime} from '@memoized-dom/router';`,
          resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/router': resolve(import.meta.dirname, '../packages/router/src/index.ts'),
        } : undefined,
        bundle: true, write: false, platform: 'browser', format: 'iife',
        globalName: 'RouterConstructor', minify: true,
      });
      const api = new Function(`${result.outputFiles[0]!.text};return RouterConstructor;`)() as {
        createRouteRuntime: (options: unknown) => RouteRuntime;
      };
      const loader = vi.fn(async () => { throw new Error('chunk unavailable'); });
      const runtime = api.createRouteRuntime({
        environment: { location: { href: 'http://localhost/' } },
        routes: [
          { id: 'home', pattern: '/' },
          { id: 'detail', pattern: '/detail', metadata: {
            componentKey: `bundled-${graph}`, moduleLoader: loader,
          } },
          { id: 'about', pattern: '/about' },
        ],
      });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = runtime.navigate('/detail');
          if (result.status !== 'preparing') throw new Error('Lazy navigation committed prematurely');
          await expect(result.finished).rejects.toThrow('chunk unavailable');
          expect(runtime.route.pathname).toBe('/');
        }
        expect(loader).toHaveBeenCalledTimes(2);
        expect(runtime.navigate('/about').status).toBe('completed');
        expect(runtime.route.pathname).toBe('/about');
        const release = runtime.blockNavigation(navigation =>
          navigation.to.pathname === '/blocked' ? false : undefined);
        expect(runtime.navigate('/blocked').status).toBe('blocked');
        expect(runtime.route.pathname).toBe('/about');
        release();
        expect(runtime.navigateRelative('?tab=logs').status).toBe('completed');
        expect(runtime.route.pathname).toBe('/about');
        expect(runtime.route.query.get('tab')).toBe('logs');
      } finally { runtime.dispose(); }
    }, 30_000);
  }
});

describe('compiled route graph capabilities', () => {
  for (const graph of ['source', 'package'] as const) {
    it(`omits public manifest construction and unused controls from the ${graph} graph`, async () => {
      const source = compileModules({ './App.tsx': `export function App(){return <main route="/">
        <a route-to="/about">About</a><p route="/">Home</p><p route="/about">About</p>
        </main>;}` })['./App.tsx']!;
      const result = await build({
        stdin: { contents: source, loader: 'ts', resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/router/internal': resolve(import.meta.dirname, '../packages/router/src/internal.ts'),
        } : undefined,
        bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', minify: true,
      });
      const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
        .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
      expect(inputs.some(path => /\/(?:src|dist)\/prepared-matcher\.(?:ts|js)$/.test(path))).toBe(true);
      expect(inputs.some(path => /\/(?:src|dist)\/manifest\.(?:ts|js)$/.test(path))).toBe(false);
      for (const control of ['navigation-blockers', 'navigation-observers', 'relative-navigation',
        'resolver-installation', 'history-controls', 'runtime-controls', 'match-controls', 'match-validation', 'general-navigation', 'snapshot-controls']) {
        expect(inputs.some(path => path.endsWith(`/${control}.ts`) || path.endsWith(`/${control}.js`))).toBe(false);
      }
      expect(result.outputFiles[0]!.text).not.toContain('Duplicate route ID');
      expect(result.outputFiles[0]!.text).not.toContain('Route parent cycle');
      expect(result.outputFiles[0]!.text).not.toContain('Route navigation blockers must be synchronous');
      expect(result.outputFiles[0]!.text).not.toContain('Route navigation exceeded 16 redirects');
      expect(result.outputFiles[0]!.text).not.toContain('Duplicate active route ID');
      expect(inputs.some(path => /\/router\/(?:src|dist)\/query\.(?:ts|js)$/.test(path))).toBe(false);
    }, 30_000);
  }
});

describe('separately imported default-runtime controls', () => {
  for (const graph of ['source', 'package'] as const) {
    it(`selects blockers without unrelated controls in the ${graph} graph`, async () => {
      const result = await build({
        stdin: { contents: `export {route,navigate,blockNavigation} from '@memoized-dom/router';`,
          resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/router': resolve(import.meta.dirname, '../packages/router/src/index.ts'),
        } : undefined,
        bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife',
        globalName: 'SelectedRouter', minify: true,
      });
      const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
        .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
      expect(inputs.some(path => /navigation-blockers\.(?:ts|js)$/.test(path))).toBe(true);
      for (const control of ['navigation-observers', 'relative-navigation',
        'resolver-installation', 'history-controls', 'runtime-controls']) {
        expect(inputs.some(path => path.endsWith(`/${control}.ts`) || path.endsWith(`/${control}.js`))).toBe(false);
      }
      const api = new Function(`${result.outputFiles[0]!.text};return SelectedRouter;`)() as {
        route: RouteRuntime['route']; navigate: RouteRuntime['navigate'];
        blockNavigation: RouteRuntime['blockNavigation'];
      };
      api.navigate('/before');
      const route = api.route;
      const release = api.blockNavigation(navigation => {
        if (navigation.to.pathname === '/blocked') return false;
        if (navigation.to.pathname === '/redirect') return { to: '/after' };
      });
      expect(api.route).toBe(route);
      expect(api.route.pathname).toBe('/before');
      expect(api.navigate('/blocked').status).toBe('blocked');
      expect(api.route.pathname).toBe('/before');
      expect(api.navigate('/redirect')).toMatchObject({ status: 'completed', redirects: 1 });
      expect(api.route.pathname).toBe('/after');
      release();
      expect(api.navigate('/blocked').status).toBe('completed');
      api.navigate('/after', { query: { text: 'alpha beta', list: ['one', 'two'] }, hash: 'section' });
      expect(api.route.query.get('text')).toBe('alpha beta');
      expect(api.route.query.getAll('list')).toEqual(['one', 'two']);
      expect(api.route.hash).toBe('#section');
    }, 30_000);

    it(`validates custom resolvers without full controls in the ${graph} graph`, async () => {
      const result = await build({
        stdin: { contents: `export {route,replaceRouteResolver} from '@memoized-dom/router/internal';`,
          resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/router/internal': resolve(import.meta.dirname, '../packages/router/src/internal.ts'),
        } : undefined,
        bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife',
        globalName: 'CustomResolver', minify: true,
      });
      const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
        .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
      expect(inputs.some(path => /match-validation\.(?:ts|js)$/.test(path))).toBe(true);
      expect(inputs.some(path => /runtime-controls\.(?:ts|js)$/.test(path))).toBe(false);
      const api = new Function(`${result.outputFiles[0]!.text};return CustomResolver;`)() as {
        route: RouteRuntime['route']; replaceRouteResolver: RouteRuntime['replaceResolver'];
      };
      expect(() => api.replaceRouteResolver(() => [
        { id: 'duplicate', pattern: '/', pathname: '/', params: {} },
        { id: 'duplicate', pattern: '/other', pathname: '/other', params: {} },
      ])).toThrow('Duplicate active route ID');
      const params = { key: 'one' };
      const release = api.replaceRouteResolver(() => [
        { id: 'manual', pattern: '/:key', pathname: '/one', params },
      ]);
      params.key = 'changed';
      expect(api.route.params.key).toBe('one');
      expect(api.route.matched?.params.key).toBe('one');
      release();
      expect(api.route.matches).toEqual([]);
    }, 30_000);

    it(`preserves the complete escaped default runtime in the ${graph} graph`, async () => {
      const result = await build({
        stdin: { contents: `export {getActiveRouteRuntime} from '@memoized-dom/router';`,
          resolveDir: resolve(import.meta.dirname, '..') },
        alias: graph === 'source' ? {
          '@memoized-dom/router': resolve(import.meta.dirname, '../packages/router/src/index.ts'),
        } : undefined,
        bundle: true, write: false, platform: 'browser', format: 'iife',
        globalName: 'EscapedRouter', minify: true,
      });
      const api = new Function(`${result.outputFiles[0]!.text};return EscapedRouter;`)() as {
        getActiveRouteRuntime(): RouteRuntime;
      };
      const runtime = api.getActiveRouteRuntime();
      expect(api.getActiveRouteRuntime()).toBe(runtime);
      for (const method of ['blockNavigation', 'subscribeNavigation', 'navigateRelative',
        'installResolver', 'back', 'forward', 'setMatches'] as const) expect(runtime[method]).toBeTypeOf('function');
      const events: string[] = [];
      const stop = runtime.subscribeNavigation(event => events.push(event.phase));
      const release = runtime.blockNavigation(() => false);
      expect(runtime.navigate('/blocked').status).toBe('blocked');
      expect(events).toEqual(['start', 'blocked']);
      release();
      expect(runtime.navigateRelative('?view=all').status).toBe('completed');
      expect(runtime.route.query.get('view')).toBe('all');
      const params = { key: 'one' };
      runtime.setMatches([{ id: 'manual', pattern: '/:key', pathname: '/one', params }]);
      params.key = 'changed';
      expect(runtime.route.params.key).toBe('one');
      expect(runtime.route.matched?.params.key).toBe('one');
      expect(() => runtime.replaceResolver(() => [
        { id: 'duplicate', pattern: '/', pathname: '/', params: {} },
        { id: 'duplicate', pattern: '/other', pathname: '/other', params: {} },
      ])).toThrow('Duplicate active route ID');
      expect(runtime.route.matched?.id).toBe('manual');
      stop();
      runtime.dispose();
      expect(() => runtime.blockNavigation(() => true)).toThrow('disposed');
    }, 30_000);
  }
});

describe('bundled lazy-only router capabilities', () => {
  for (const graph of ['source','package'] as const) {
    it(`omits routed data while retaining lazy retries through the ${graph} graph`, async () => {
      const result = await build({stdin:{contents:`
        import {route,navigateRoute,createRouteManifest,replaceRouteResolver,registerRouteComponent,
          prepareInitialRouteModules} from '@memoized-dom/router/internal';
        let attempts=0;
        const manifest=createRouteManifest([{id:'home',pattern:'/'},{id:'detail',pattern:'/detail',metadata:{
          componentKey:'lazy-only-${graph}',moduleLoader:async()=>{
            if(++attempts===1)throw new Error('chunk unavailable');
            registerRouteComponent('lazy-only-${graph}',()=>null);
          }}}]);
        export async function initialize(){replaceRouteResolver(manifest.resolve);await prepareInitialRouteModules();}
        export {route,navigateRoute};`,resolveDir:resolve(import.meta.dirname,'..')},
        alias:graph==='source'?{'@memoized-dom/router/internal':resolve(import.meta.dirname,'../packages/router/src/internal.ts')}:undefined,
        bundle:true,write:false,platform:'browser',format:'iife',globalName:'LazyRouter',minify:true});
      const code=result.outputFiles[0]!.text;
      expect(code).not.toContain('/_memoized/routed');
      expect(code).not.toContain('requires an active server request context');
      const api=new Function(`${code};return LazyRouter;`)() as {
        initialize():Promise<void>;route:RouteRuntime['route'];navigateRoute:RouteRuntime['navigate'];
      };
      await api.initialize();api.navigateRoute('/');
      const first=api.navigateRoute('/detail');
      if(first.status!=='preparing')throw new Error('Lazy navigation committed prematurely');
      await expect(first.finished).rejects.toThrow('chunk unavailable');expect(api.route.pathname).toBe('/');
      const second=api.navigateRoute('/detail');
      if(second.status!=='preparing')throw new Error('Lazy retry committed prematurely');
      await expect(second.finished).resolves.toMatchObject({status:'completed'});expect(api.route.pathname).toBe('/detail');
      api.navigateRoute('/');
    }, 30_000);
  }
});
