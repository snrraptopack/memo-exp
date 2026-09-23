import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile, compileModules } from '@memoized-dom/compiler';
import { resolveStaticWrites, resetScheduler, setScheduler } from '@memoized-dom/runtime';
import { _internals, unregister } from '@memoized-dom/runtime/testing';
import { navigateRoute } from '@memoized-dom/router/internal';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const outputFile = join(outDir, 'r47-router.compiled.ts');

const SOURCE = `
  const palette = { open: false };

  function openPalette() {
    palette.open = true;
  }

  function About() {
    return <div id="about">About</div>;
  }

  export function App() {
    const projectId = 'compiler';
    return <main id="layout" route="/">
      <a id="home" route-to="/">Home</a>
      <a id="open" route-to={{
        path: '/projects/:projectId',
        params: { projectId },
      }}>Open project</a>
      <a id="open-about" route-to="/about">About</a>
      <button id="open-palette" onClick={openPalette}>Palette</button>
      <span id="palette" if={palette.open}>Command palette</span>
      <About route="/about" />
      <section id="projects" route="/projects">
        Projects
        <article id="project" route="/:projectId">Project detail</article>
      </section>
      <aside id="missing" route="/*">Missing</aside>
    </main>;
  }
`;

describe('compiled router DOM integration', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outputFile, compile(SOURCE, { moduleId: './RouteApp.tsx' }));
  });

  afterEach(() => {
    unregister('App');
    unregister('CrossFileApp');
    unregister('PreparedApp');
    unregister('SelectedRouteApp');
    resetScheduler();
    document.body.replaceChildren();
  });

  it('renders a component-owned subtree at two route-bearing callsites', async () => {
    const files = compileModules({
      './CrossFileApp.compiled.tsx': `
        import { Reports } from './Reports.compiled.tsx';
        export function CrossFileApp() {
          return <main route="/"><Reports route="/reports" /><Reports route="/admin/reports" /></main>;
        }
      `,
      './Reports.compiled.tsx': `
        export function Reports() {
          return <section><h1 data-index route="/">Index</h1><p data-detail route="/:id">Detail</p></section>;
        }
      `,
    });
    writeFileSync(join(outDir, 'CrossFileApp.compiled.tsx'), files['./CrossFileApp.compiled.tsx']!);
    writeFileSync(join(outDir, 'Reports.compiled.tsx'), files['./Reports.compiled.tsx']!);
    const { CrossFileApp } = await import(
      /* @vite-ignore */ pathToFileURL(join(outDir, 'CrossFileApp.compiled.tsx')).href
    );

    navigateRoute('/reports/42', { replace: true });
    document.body.append(CrossFileApp('CrossFileApp', null));
    expect(document.querySelectorAll('[data-detail]')).toHaveLength(1);
    expect(document.querySelector('[data-index]')).toBeNull();

    navigateRoute('/admin/reports/99');
    expect(document.querySelectorAll('[data-detail]')).toHaveLength(1);
    expect(document.querySelector('[data-index]')).toBeNull();

    navigateRoute('/reports');
    expect(document.querySelectorAll('[data-index]')).toHaveLength(1);
    expect(document.querySelector('[data-detail]')).toBeNull();
  });

  it('updates static route reads only when their selected values change', async () => {
    const source = `
      import { route } from '@memoized-dom/router';
      export function SelectedRouteApp() {
        const id = route.params.id;
        const tab = route.query.get('tab');
        return <main route="/projects/:id"><p id="selection">{id}:{tab}</p></main>;
      }
    `;
    const file = join(outDir, 'SelectedRouteApp.compiled.ts');
    writeFileSync(file, compile(source, { moduleId: './SelectedRouteApp.tsx' }));
    const { SelectedRouteApp } = await import(
      /* @vite-ignore */ pathToFileURL(file).href
    );
    setScheduler(run => run());
    navigateRoute('/projects/one', {
      replace: true,
      query: { tab: 'board' },
    });
    document.body.append(SelectedRouteApp('SelectedRouteApp', null));
    const entity = _internals().registry.get('SelectedRouteApp')!;
    const originalRender = entity.render;
    let renders = 0;
    entity.render = reasons => {
      renders++;
      originalRender(reasons);
    };

    navigateRoute('/projects/one', { query: { tab: 'board', page: 2 } });
    navigateRoute('/projects/one', {
      query: { tab: 'board', page: 2 },
      hash: 'notes',
    });
    expect(renders).toBe(0);

    navigateRoute('/projects/one', { query: { tab: 'activity', page: 2 } });
    expect(renders).toBe(1);
    expect(document.querySelector('#selection')?.textContent).toBe('one:activity');

    navigateRoute('/projects/two', { query: { tab: 'activity', page: 2 } });
    expect(renders).toBe(2);
    expect(document.querySelector('#selection')?.textContent).toBe('two:activity');
  });

  it('keeps compiled $routed reads isolated across reused route callsites', async () => {
    const files = compileModules({
      './PreparedApp.compiled.tsx': `
        import { Reports } from './PreparedReports.compiled.tsx';
        export function PreparedApp() {
          return <main route="/"><Reports route="/reports" /><Reports route="/admin/reports" /></main>;
        }
      `,
      './PreparedReports.compiled.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function Reports() {
          const visits = $routed(({ state }) => {
            state.visits = Number(state.visits ?? 0) + 1;
            return state.visits;
          });
          return <p data-visits>{visits}</p>;
        }
      `,
    });
    writeFileSync(join(outDir, 'PreparedApp.compiled.tsx'), files['./PreparedApp.compiled.tsx']!);
    writeFileSync(join(outDir, 'PreparedReports.compiled.tsx'), files['./PreparedReports.compiled.tsx']!);
    const { PreparedApp } = await import(
      /* @vite-ignore */ pathToFileURL(join(outDir, 'PreparedApp.compiled.tsx')).href
    );
    navigateRoute('/', { replace: true });
    document.body.append(PreparedApp('PreparedApp', null));
    for (const [path, visits] of [
      ['/reports', '1'],
      ['/admin/reports', '1'],
      ['/reports', '2'],
    ] as const) {
      const result = navigateRoute(path);
      if (result.status !== 'preparing') throw new Error('expected preparation');
      await result.finished;
      expect(document.querySelector('[data-visits]')?.textContent).toBe(visits);
    }
  });

  it('mounts nearest-ancestor route chains, navigates, and falls back to catch-all', async () => {
    const { App } = await import(/* @vite-ignore */ pathToFileURL(outputFile).href);
    navigateRoute('/', { replace: true });
    document.body.append(App('App', null));

    expect(document.querySelector('#layout')).not.toBeNull();
    expect(document.querySelector('#projects')).toBeNull();
    expect(document.querySelector('#about')).toBeNull();
    expect(document.querySelector('#missing')).toBeNull();
    expect(document.querySelector('#palette')).toBeNull();
    expect(resolveStaticWrites(['./RouteApp.tsx#palette.open']))
      .toContain('App/route0/when0');

    document.querySelector<HTMLButtonElement>('#open-palette')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('#palette')?.textContent).toBe('Command palette');
    });

    document.querySelector<HTMLAnchorElement>('#open-about')!.click();
    expect(document.querySelector('#about')).not.toBeNull();
    expect(document.querySelector('#projects')).toBeNull();

    document.querySelector<HTMLAnchorElement>('#open')!.click();
    expect(document.querySelector('#about')).toBeNull();
    expect(document.querySelector('#projects')).not.toBeNull();
    expect(document.querySelector('#project')).not.toBeNull();
    expect(document.querySelector('#missing')).toBeNull();

    document.querySelector<HTMLAnchorElement>('#home')!.click();
    expect(document.querySelector('#projects')).toBeNull();

    navigateRoute('/not-declared');
    expect(document.querySelector('#missing')).not.toBeNull();
    expect(document.querySelector('#projects')).toBeNull();
  });
});
