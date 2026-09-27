import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToString } from '@memoized-dom/server';
import {
  mount,
  registerRootFactory,
  resetScheduler,
  setScheduler,
  type MountedApplication,
} from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';
import { navigateRoute } from '@memoized-dom/router/internal';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out');
const files = compileModules({
  './HydratedRouteApp.compiled.tsx': `
    import { List } from './HydratedRouteList.compiled.tsx';
    export function App() {
      return <main><section route="/expeditions">
        <List route="/" />
        <article id="detail" route="/:id">Detail</article>
      </section></main>;
    }
  `,
  './HydratedRouteList.compiled.tsx': `
    export function List() {
      let ready = true;
      return <>
        <button id="toggle" onClick={() => { ready = !ready; }}>Toggle</button>
        {ready ? <div id="list">Expeditions</div> : null}
      </>;
    }
  `,
});
mkdirSync(outDir, { recursive: true });
for (const [name, source] of Object.entries(files)) {
  writeFileSync(join(outDir, name), source);
}

let mounted: MountedApplication | undefined;

beforeEach(() => {
  document.body.replaceChildren();
  setScheduler(run => run());
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetScheduler();
});

describe('hydrated component-owned route fragments', () => {
  it('removes adopted and later-added list content across route changes', async () => {
    const { App } = await import(
      /* @vite-ignore */ pathToFileURL(join(outDir, 'HydratedRouteApp.compiled.tsx')).href
    );
    navigateRoute('/expeditions', { replace: true });
    registerRootFactory(App, {
      id: 'App',
      create: () => App('App', null),
    });
    const host = document.createElement('div');
    host.id = 'root';
    host.innerHTML = renderToString(App, {
      markers: true,
      url: 'http://localhost/expeditions',
    });
    document.body.appendChild(host);
    expect(host.querySelectorAll('#list')).toHaveLength(1);

    mounted = mount('root', App);
    navigateRoute('/expeditions/ice-cores');
    expect(host.querySelector('#list')).toBeNull();
    expect(host.querySelectorAll('#detail')).toHaveLength(1);

    navigateRoute('/expeditions');
    expect(host.querySelectorAll('#list')).toHaveLength(1);
    expect(host.querySelector('#detail')).toBeNull();

    host.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(host.querySelector('#list')).toBeNull();
    host.querySelector<HTMLButtonElement>('#toggle')!.click();
    expect(host.querySelectorAll('#list')).toHaveLength(1);

    navigateRoute('/expeditions/ice-cores');
    expect(host.querySelector('#list')).toBeNull();
    expect(host.querySelectorAll('#detail')).toHaveLength(1);
  });
});
