import { describe, expect, it } from 'vitest';
import {
  compile,
  compileModules,
  compileModulesDetailed,
  diagnoseModules,
} from '@memoized-dom/compiler';

describe('compiler-owned JSX routing', () => {
  it('composes nearest route ancestors and emits route regions plus one manifest', () => {
    const code = compile(`
      function App() {
        return (
          <main route="/">
            <section route="/projects">
              <article route="/:projectId">Project</article>
            </section>
            <aside route="/*">Missing</aside>
          </main>
        );
      }
    `, { moduleId: './App.tsx' });

    expect(code).toContain('@memoized-dom/router/internal');
    expect(code).toContain('createRouteManifest');
    expect(code).toContain('replaceRouteResolver');
    expect(code).toContain('subscribeRouteSelected');
    expect(code).toContain('pattern: "/projects"');
    expect(code).toContain('pattern: "/:projectId"');
    expect(code).toContain('pattern: "/*"');
    expect(code).not.toContain('setAttribute("route"');
  });

  it('lowers route-to into anchor hrefs', () => {
    const code = compile(`
      function App() {
        const projectId = 'compiler';
        return (
          <main route="/">
            <section route="/projects">
              <article route="/:projectId">Project</article>
              <a route-to="/projects">Projects</a>
              <a
                route-to={{
                  path: '/projects/:projectId',
                  params: { projectId },
                  query: { tab: 'activity' },
                }}
              >Open</a>
            </section>
          </main>
        );
      }
    `);

    expect(code).toContain('href');
    expect(code).toContain('buildRoutePath("/projects/:projectId"');
    expect(code).not.toContain('route-to');
  });

  it('checks route-to destinations and exact parameter keys, including catch-alls', () => {
    expect(() => compile(`
      function App() {
        return <main route="/"><section route="/projects"><p route="/:id" /></section><p route="/*" /><a route-to="/missing" /></main>;
      }
    `)).toThrow("undeclared route '/missing'");

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/:id" /><a route-to={{ path: '/:id' }} /></main>;
      }
    `)).toThrow('requires params { id }');

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/:id" /><a route-to={{ path: '/:id', params: { wrong: 1 } }} /></main>;
      }
    `)).toThrow('missing id; unknown wrong');

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/:id" /><a route-to={{ path: '/:id', params: { id: 1, id: 2 } }} /></main>;
      }
    `)).toThrow("duplicate 'id'");

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/*" /><a route-to={{ path: '/*', params: {} }} /></main>;
      }
    `)).toThrow('missing *');

    expect(compile(`
      function App() {
        const rest = 'docs/setup';
        return <main route="/"><p route="/*" /><a route-to={{ path: '/*', params: { '*': rest } }} /></main>;
      }
    `)).toContain("'*': rest");
  });

  it('rejects route-to on non-anchor elements', () => {
    expect(() => compile(`function App() { return <main route="/"><button route-to="/" /></main>; }`))
      .toThrow('route-to requires an anchor');
    expect(() => compile(`function App() { return <main route="/"><a route-to={{ path: '/', replace: true }} /></main>; }`))
      .toThrow("does not support 'replace'");
  });

  it('requires canonical slashes, terminal catch-alls, and private history state', () => {
    expect(() => compile(`function App() { return <main route="projects" />; }`))
      .toThrow("must begin with '/'");
    expect(() => compile(`function App() { return <main route="/"><div route="/*"><p route="/child" /></div></main>; }`))
      .toThrow('cannot have child routes');
    expect(() => compile(`function App() { return <main route="/"><button route-to={{ path: '/', state: { hidden: true } }} /></main>; }`))
      .toThrow("does not support 'state'");
  });

  it('validates route-to against routes collected from the linked module graph', () => {
    const output = compileModules({
      './App.tsx': `
        import { ProjectRoutes } from './ProjectRoutes';
        function App() {
          return <main route="/"><ProjectRoutes route="/projects" /><a route-to="/projects" /></main>;
        }
      `,
      './ProjectRoutes.tsx': `
        export function ProjectRoutes() {
          return <section>Projects</section>;
        }
      `,
    });

    expect(output['./App.tsx']).toContain('createRouteManifest');
    expect(output['./App.tsx']).toContain('subscribeRouteSelected');
  });

  it('instantiates an imported route subtree at each route-bearing callsite', () => {
    const compiled = compileModulesDetailed({
      './App.tsx': `
        import { Reports } from './Reports';
        export function App() {
          return <main route="/"><Reports route="/reports" /><Reports route="/admin/reports" /></main>;
        }
      `,
      './Reports.tsx': `
        export function Reports() {
          return <section><h1 route="/">Index</h1><p route="/:id">Detail</p></section>;
        }
      `,
    });
    const manifest = compiled.output['./App.tsx']!;
    expect(compiled.routes.map(route => route.pattern)).toEqual([
      '/', '/admin/reports', '/admin/reports/:id', '/reports', '/reports/:id',
    ]);
    expect(manifest).toContain('>>');
    expect(compiled.routeDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pattern: '/reports',
        moduleId: './App.tsx',
        componentModuleId: './Reports.tsx',
        componentKey: './Reports.tsx#Reports',
      }),
    ]));
    expect(compiled.routeDefinitions.find(route => route.pattern === '/reports/:id'))
      .toEqual(expect.objectContaining({ moduleId: './Reports.tsx' }));
    expect(manifest).toContain('componentModuleId: "./Reports.tsx"');
    expect(compiled.output['./Reports.tsx']).toContain('routeContext');
  });

  it('splits route-exclusive imports only in client output', () => {
    const modules = {
      './App.tsx': `
        import { Detail } from './Detail';
        export function App() { return <main route="/"><Detail route="/detail" /></main>; }
      `,
      './Detail.tsx': `export function Detail() { return <p>Detail</p>; }`,
    };
    const client = compileModulesDetailed(modules, { routedEnvironment: 'client' });
    const server = compileModulesDetailed(modules, { routedEnvironment: 'server' });
    expect(client.output['./App.tsx']).not.toContain('import { Detail } from');
    expect(client.output['./App.tsx']).toContain('import("./Detail.tsx")');
    expect(client.output['./App.tsx']).toContain('readRouteComponent');
    expect(client.output['./App.tsx']).toContain('prepareInitialRouteModules');
    expect(server.output['./App.tsx']).toContain('import { Detail } from');
    expect(server.output['./App.tsx']).not.toContain('prepareInitialRouteModules');

    const eager = compileModulesDetailed({
      ...modules,
      './App.tsx': `
        import { Detail } from './Detail';
        export function App() { return <main route="/"><Detail route="/detail" /><Detail /></main>; }
      `,
    }, { routedEnvironment: 'client' });
    expect(eager.output['./App.tsx']).toContain('import { Detail } from');
    expect(eager.output['./App.tsx']).not.toContain('prepareInitialRouteModules');
  });

  it('loads aliased route component imports by their exported name', () => {
    const compiled = compileModulesDetailed({
      './App.tsx': `
        import { Detail as Report } from './Detail';
        export function App() { return <Report route="/report" />; }
      `,
      './Detail.tsx': `export function Detail() { return <p>Detail</p>; }`,
    }, { routedEnvironment: 'client' });
    expect(compiled.output['./App.tsx']).toContain('import("./Detail.tsx")');
    expect(compiled.output['./App.tsx']).toContain('module["Detail"]');
    expect(compiled.routeDefinitions[0]).toEqual(expect.objectContaining({
      componentModuleId: './Detail.tsx',
    }));
  });

  it('keeps semantic route IDs stable when source lines move', () => {
    const source = `function App() { return <main route="/"><p route="/reports" /></main>; }`;
    const first = compile(source, { moduleId: './App.tsx' });
    const shifted = compile(`\n\n${source}`, { moduleId: './App.tsx' });
    expect([...first.matchAll(/id: "([^"]+)"/g)].map(match => match[1]))
      .toEqual([...shifted.matchAll(/id: "([^"]+)"/g)].map(match => match[1]));
  });

  it('composes route subtrees through more than one imported component', () => {
    const compiled = compileModulesDetailed({
      './App.tsx': `
        import { Reports } from './Reports';
        export function App() { return <Reports route="/reports" />; }
      `,
      './Reports.tsx': `
        import { ReportPage } from './ReportPage';
        export function Reports() { return <ReportPage route="/:id" />; }
      `,
      './ReportPage.tsx': `
        export function ReportPage() { return <p route="/details">Details</p>; }
      `,
    });
    expect(compiled.routes.map(route => route.pattern)).toEqual([
      '/reports', '/reports/:id', '/reports/:id/details',
    ]);
  });

  it('validates navigation in one module against routes declared in another', () => {
    const output = compileModules({
      './App.tsx': `
        import { StoryLink } from './StoryLink';
        export function App() {
          return <main route="/"><article route="/item/:storyId" /><StoryLink /></main>;
        }
      `,
      './StoryLink.tsx': `
        export function StoryLink() {
          const storyId = 42;
          return <a route-to={{ path: '/item/:storyId', params: { storyId } }}>Story</a>;
        }
      `,
    });

    expect(output['./StoryLink.tsx']).toContain('buildRoutePath');
    expect(output['./StoryLink.tsx']).not.toContain('route-to');
  });

  it('replays component derivations when URL state changes within one route', () => {
    const code = compile(`
      import { route as currentRoute } from '@memoized-dom/router';

      export function App() {
        const tab = currentRoute.query.get('tab') ?? 'board';
        return (
          <main route="/projects/:projectId">
            <p if={tab === 'board'}>Board</p>
            <p if={tab === 'activity'}>Activity</p>
          </main>
        );
      }
    `);

    expect(code).toMatch(/let tab = currentRoute\.query\.get\(['"]tab['"]\) \?\? ['"]board['"]/);
    expect(code).toContain('subscribeRouteValue as _subscribeExternal');
    expect(code).toMatch(/tab = currentRoute\.query\.get\(['"]tab['"]\) \?\? ['"]board['"]/);
    expect(code).toContain('markDirty(_id)');
    expect(code).toContain('_routeRegion.update()');
  });

  it('selects static route fields and literal query keys', () => {
    const code = compile(`
      import { route as currentRoute } from '@memoized-dom/router';
      export function App() {
        const id = currentRoute.params.id;
        const tab = currentRoute.query.get('tab');
        const path = currentRoute.pathname;
        return <main><p>{id}:{tab}:{path}</p></main>;
      }
    `);

    expect(code).toContain('subscribeRouteSelectedValue');
    expect(code).toMatch(/selectedRoute\["params"\]\["id"\]/);
    expect(code).toMatch(/selectedRoute\d*\.query\.get\("tab"\)/);
    expect(code).toMatch(/selectedRoute\d*\["pathname"\]/);
    expect(code).not.toMatch(/_subscribeExternal\(currentRoute,/);
    expect(code).not.toContain('volatile: true');
  });

  it('keeps the whole-route subscription for dynamic route reads', () => {
    const code = compile(`
      import { route } from '@memoized-dom/router';
      export function App() {
        const field = 'id';
        return <main>{route.params[field]}</main>;
      }
    `);

    expect(code).toMatch(/_subscribeExternal\(route,/);
    expect(code).not.toContain('subscribeRouteSelectedValue');

    const dynamicQuery = compile(`
      import { route } from '@memoized-dom/router';
      export function App() {
        const key = 'tab';
        return <main>{route.query.get(key)}</main>;
      }
    `);
    expect(dynamicQuery).toMatch(/_subscribeExternal\(route,/);
    expect(dynamicQuery).not.toContain('subscribeRouteSelectedValue');
  });

  it('uses the same external-reactivity contract for third-party live values', () => {
    const code = compile(`
      import { location as currentLocation } from 'portable-router';

      export function App() {
        const section = currentLocation.section;
        return <main><p>{section}</p></main>;
      }
    `, {
      externalReactiveSources: [{
        module: 'portable-router',
        source: 'location',
        subscribe: {
          module: 'portable-router/memoized-dom',
          export: 'subscribeLocation',
        },
      }],
    });

    expect(code).toContain(
      'subscribeLocation as _subscribeExternal',
    );
    expect(code).toContain(
      '_subscribeExternal(currentLocation, () => _MD.markDirty(_id))',
    );
    expect(code).toMatch(/section = currentLocation\.section/);
  });

  it('reports the owning module and authored route attribute location', () => {
    const diagnostics = diagnoseModules({
      './App.tsx': `
        import { StoryLink } from './StoryLink';
        export function App() { return <main route="/"><StoryLink /></main>; }
      `,
      './StoryLink.tsx': `
        export function StoryLink() {
          return <a route-to="/missing">Missing</a>;
        }
      `,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      moduleId: './StoryLink.tsx',
      line: 3,
    });
    expect(diagnostics[0]!.column).toBeGreaterThan(0);
  });
});
