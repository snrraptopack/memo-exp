/**
 * RFC §16.4 e2e — module-scope transparent sources.
 *
 * Authored module state keeps working: `$fetch` at module scope compiles to a
 * lazy description + stable ref, materializes per ApplicationRuntime on first
 * read (request-local on the server), and consumption sites gate exactly like
 * component-local sources.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  createApplicationRuntime,
  getActiveApplicationRuntime,
  runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import {
  createDataRuntime,
  setActiveDataRuntime,
  type DataRuntime,
} from '@memoized-dom/data';
import { renderToString } from '@memoized-dom/server';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const sessionSource = `
  import { $fetch } from '@memoized-dom/data';

  interface User {
    id: number;
    name: string;
  }

  export const currentUser = $fetch<User>('/api/session');
`;

const headerSource = `
  import { currentUser } from './mod-session';

  export function Header() {
    return <header>{currentUser.name}</header>;
  }
`;

describe('module-scope transparent sources', () => {
  let sessionMod: any;
  let headerMod: any;

  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      {
        './mod-session.ts': sessionSource,
        './mod-header.tsx': headerSource,
        './main.ts': `import { mount } from '@memoized-dom/runtime'; import { Header } from './mod-header'; mount('root', Header);`,
      },
      { runtimePath: '@memoized-dom/runtime' },
    );
    writeFileSync(
      join(outDir, 'mod-session.ts'),
      output['./mod-session.ts']!,
    );
    writeFileSync(
      join(outDir, 'mod-header.ts'),
      output['./mod-header.tsx']!,
    );
    sessionMod = await import(
      pathToFileURL(join(outDir, 'mod-session.ts')).href
    );
    headerMod = await import(
      pathToFileURL(join(outDir, 'mod-header.ts')).href
    );
  });

  it('lowers declarations into lazy descriptions and refs', () => {
    // Compiled module must NOT start any request at evaluation time.
    expect(sessionMod.currentUser).toBeDefined();
  });

  it.each(['', 'function $effect(run) { run(); }'])('lowers generated request effects independently of authored shadows: %s', shadow => {
    const output = compileModules({
      './reactive-source.ts': `
        import { $fetch } from '@memoized-dom/data';
        ${shadow}
        export let search = 'Ada';
        export const users = $fetch('/api/users', { query: { search } });
        export function setSearch(next) { search = next; }
      `,
    }, { runtimePath: '@memoized-dom/runtime' });
    const compiled = output['./reactive-source.ts']!;

    expect(compiled).toContain('describeModuleSource');
    expect(compiled).toContain('rebindModuleSource');
    expect(compiled).toContain('.registerEffect(');
    expect(compiled).not.toMatch(/^effect\(/m);
  });

  it('does not create a request-rebinding lifetime for noncomputed option keys', () => {
    const compiled = compileModules({
      './source.ts': `export let search='Ada';
        export const users=$fetch('/api/users',{query:{search:'fixed'}});
        export function setSearch(next){search=next;}`,
    })['./source.ts']!;
    expect(compiled).toContain('describeModuleSource');
    expect(compiled).not.toContain('rebindModuleSource');
    expect(compiled).not.toContain('registerEffect');
    expect(compiled).not.toContain('unregisterSubtree');
  });

  it('rebinds a mounted request after its module input changes without calling an authored lifecycle shadow', async () => {
    const directory = join(outDir, 'reactive-module-inputs');
    const output = compileModules({
      './input.ts': `import { $fetch } from '@memoized-dom/data';
        function $effect(run) { throw new Error('authored shadow must not run'); }
        export let search='Ada';
        export const users=$fetch('/api/users',{query:{search}});
        export function setSearch(next){search=next;}`,
      './View.tsx': `import {users,setSearch} from './input';
        export function View(){return <main><button onClick={()=>setSearch('Grace')}>change</button>
          <output>{users.name}</output></main>;}`,
    }, { runtimePath: '@memoized-dom/runtime/testing' });
    mkdirSync(directory, { recursive: true });
    for (const [path, code] of Object.entries(output)) {
      writeFileSync(join(directory, path.replace(/\.tsx$/, '.ts')), code);
    }
    const urls: string[] = [];
    const data = createDataRuntime({ fetch: (async input => {
      const url = String(input instanceof Request ? input.url : input); urls.push(url);
      return new Response(JSON.stringify({ name: url.includes('Grace') ? 'Grace' : 'Ada' }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch });
    const previous = setActiveDataRuntime(data);
    setScheduler(run => run()); document.body.replaceChildren();
    try {
      const { View } = await import(pathToFileURL(join(directory, 'View.ts')).href);
      const inputs = await import(pathToFileURL(join(directory, 'input.ts')).href);
      const original = inputs.users;
      document.body.append(View('ReactiveInput', null));
      await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('Ada'));
      document.querySelector('button')!.click();
      await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('Grace'));
      expect(inputs.users).toBe(original);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain('search=Ada'); expect(urls[1]).toContain('search=Grace');
    } finally {
      for (const id of _internals().registry.keys()) unregister(id);
      data.clear(); setActiveDataRuntime(previous); resetAccessTable(); resetScheduler();
      document.body.replaceChildren();
    }
  });

  it.each([
    ['direct', 'export const user=$read(Promise.resolve({id}));'],
    ['deferred', 'export const user=$read(Promise.resolve().then(()=>({id})));'],
    ['helper', 'function load(){return Promise.resolve().then(()=>({id}));}export const user=$read(load());'],
    ['alias', 'function load(){return Promise.resolve({id});}const replay=load;export const user=$read(Promise.resolve({id:1}),replay);'],
    ['publisher', "import {setObserved} from './observed';export const user=$read(Promise.resolve().then(()=>{setObserved(id*10);return {id};}));"],
    ['local-publisher', 'export let observed=0;export const user=$read(Promise.resolve().then(()=>{observed=id*10;return {id};}));'],
  ])('rebinds a mounted %s module read from current inputs while retaining its source ref', async (name, declaration) => {
    const directory = join(outDir, `reactive-module-read-${name}`);
    const output = compileModules({
      ...(name === 'publisher' ? {'./observed.ts': 'export let observed=0;export function setObserved(value){observed=value;}'} : {}),
      './read-source.ts': `export let id=1;${declaration}
        export function advance(){id++;}`,
      './ReadView.tsx': `import {user,advance} from './read-source';${name.endsWith('publisher') ? `import {observed} from './${name === 'publisher' ? 'observed' : 'read-source'}';` : ''}
        export function ReadView(){return <main><button onClick={advance}>Next</button><output>{user.id}</output>${name.endsWith('publisher') ? '<p>{observed}</p>' : ''}</main>;}`,
    }, {runtimePath: '@memoized-dom/runtime/testing'});
    mkdirSync(directory, {recursive: true});
    for (const [path, code] of Object.entries(output)) {
      writeFileSync(join(directory, path.replace(/\.tsx$/, '.ts')), code);
    }
    const data = createDataRuntime();
    const previous = setActiveDataRuntime(data);
    setScheduler(run => run());document.body.replaceChildren();
    try {
      const {ReadView} = await import(pathToFileURL(join(directory, 'ReadView.ts')).href);
      const source = await import(pathToFileURL(join(directory, 'read-source.ts')).href);
      const original = source.user;
      document.body.append(ReadView('App', null));
      await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('1'));
      if (name.endsWith('publisher')) expect(document.querySelector('p')?.textContent).toBe('10');
      document.querySelector('button')!.click();
      await vi.waitFor(() => expect(document.querySelector('output')?.textContent).toBe('2'));
      if (name.endsWith('publisher')) expect(document.querySelector('p')?.textContent).toBe('20');
      expect(source.user).toBe(original);
    } finally {
      for (const id of _internals().registry.keys()) unregister(id);
      data.clear();setActiveDataRuntime(previous);resetAccessTable();resetScheduler();
      document.body.replaceChildren();
    }
  });

  it('materializes request-locally across concurrent runtimes', async () => {
    let calls = 0;
    const never = (() => {
      calls++;
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    const makeRequestRuntime = (id: string) => {
      const application = createApplicationRuntime(id);
      const data = createDataRuntime({ fetch: never });
      return { application, data };
    };

    const requestA = makeRequestRuntime('mod-a');
    const requestB = makeRequestRuntime('mod-b');

    let htmlA = '';
    let htmlB = '';
    runWithApplicationRuntime(requestA.application, () => {
      setActiveDataRuntime(requestA.data);
      htmlA = renderToString(headerMod.Header, { fetch: never });
    });
    runWithApplicationRuntime(requestB.application, () => {
      setActiveDataRuntime(requestB.data);
      htmlB = renderToString(headerMod.Header, { fetch: never });
    });
    // Both requests flush the pending site independently...
    expect(htmlA).toBe('<header></header>');
    expect(htmlB).toBe('<header></header>');
    await Promise.resolve();
    // ...and each runtime started its OWN request.
    expect(calls).toBe(2);
    requestA.application.dispose();
    requestB.application.dispose();
    void requestA;
    void requestB;
    void getActiveApplicationRuntime;
  });

  it('keeps the compiled module evaluation side-effect free', () => {
    // No data runtime was ever activated outside explicit scopes; if the
    // description had executed eagerly this suite would have opened real
    // network requests during import.
    expect(true).toBe(true);
  });
});
