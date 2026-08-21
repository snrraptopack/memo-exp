import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import { unregister } from '@memoized-dom/runtime/testing';
import { navigateRoute } from '@memoized-dom/router/internal';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const outputFile = join(outDir, 'r47-router.compiled.ts');

const SOURCE = `
  function About() {
    return <div id="about">About</div>;
  }

  export function App() {
    const projectId = 'compiler';
    return <main id="layout" route="/">
      <a id="home" route-to="/">Home</a>
      <button id="open" route-to={{
        path: '/projects/:projectId',
        params: { projectId },
      }}>Open project</button>
      <button id="open-about" route-to="/about">About</button>
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
    unregister('RouteApp');
    document.body.replaceChildren();
  });

  it('mounts nearest-ancestor route chains, navigates, and falls back to catch-all', async () => {
    const { App } = await import(/* @vite-ignore */ pathToFileURL(outputFile).href);
    navigateRoute('/', { replace: true });
    document.body.append(App('RouteApp', null));

    expect(document.querySelector('#layout')).not.toBeNull();
    expect(document.querySelector('#projects')).toBeNull();
    expect(document.querySelector('#about')).toBeNull();
    expect(document.querySelector('#missing')).toBeNull();

    document.querySelector<HTMLButtonElement>('#open-about')!.click();
    expect(document.querySelector('#about')).not.toBeNull();
    expect(document.querySelector('#projects')).toBeNull();

    document.querySelector<HTMLButtonElement>('#open')!.click();
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
