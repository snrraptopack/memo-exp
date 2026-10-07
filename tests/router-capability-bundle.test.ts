import { resolve } from 'node:path';
import { build } from 'esbuild';
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
      } finally { runtime.dispose(); }
    });
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
    });
  }
});
