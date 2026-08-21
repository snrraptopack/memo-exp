import { describe, expect, it } from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';

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

  it('lowers route-to into hrefs and composed click navigation', () => {
    const code = compile(`
      let clicked = 0;
      function App() {
        const projectId = 'compiler';
        return (
          <main route="/">
            <section route="/projects">
              <article route="/:projectId">Project</article>
              <a route-to="/projects">Projects</a>
              <button
                onClick={() => clicked++}
                route-to={{
                  path: '/projects/:projectId',
                  params: { projectId },
                  query: { tab: 'activity' },
                }}
              >Open</button>
            </section>
          </main>
        );
      }
    `);

    expect(code).toContain('href');
    expect(code).toContain('navigateRoute("/projects/:projectId"');
    expect(code).toContain('defaultPrevented');
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
        return <main route="/"><p route="/:id" /><button route-to={{ path: '/:id' }} /></main>;
      }
    `)).toThrow('requires params { id }');

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/:id" /><button route-to={{ path: '/:id', params: { wrong: 1 } }} /></main>;
      }
    `)).toThrow('missing id; unknown wrong');

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/:id" /><button route-to={{ path: '/:id', params: { id: 1, id: 2 } }} /></main>;
      }
    `)).toThrow("duplicate 'id'");

    expect(() => compile(`
      function App() {
        return <main route="/"><p route="/*" /><button route-to={{ path: '/*', params: {} }} /></main>;
      }
    `)).toThrow('missing *');

    expect(compile(`
      function App() {
        const rest = 'docs/setup';
        return <main route="/"><p route="/*" /><button route-to={{ path: '/*', params: { '*': rest } }} /></main>;
      }
    `)).toContain("'*': rest");
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
});
