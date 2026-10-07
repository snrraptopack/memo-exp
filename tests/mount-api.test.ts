import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import {
  has,
  mount,
  register,
  registerRootFactory,
  type MountableComponent,
  type MountedApplication,
} from '@memoized-dom/runtime/testing';

const mounted: MountedApplication[] = [];

afterEach(() => {
  for (const application of mounted.splice(0)) application.unmount();
  document.body.replaceChildren();
});

function rootFactory(id: string): MountableComponent {
  const component = () => undefined;
  registerRootFactory(component, {
    id,
    create() {
      register({ id, parent: null, render() {} });
      const node = document.createElement('main');
      node.textContent = id;
      return node;
    },
  });
  return component;
}

describe('application mount boundary', () => {
  it('mounts by exact element id and owns its root nodes', () => {
    const host = document.createElement('div');
    host.id = 'root';
    document.body.append(host);

    const application = mount('root', rootFactory('App'));
    mounted.push(application);

    expect(application.host).toBe(host);
    expect(application.rootId).toBe('App');
    expect(application.mounted).toBe(true);
    expect(host.textContent).toBe('App');
    expect(has('App')).toBe(true);

    application.unmount();
    application.unmount();
    expect(application.mounted).toBe(false);
    expect(host.childNodes).toHaveLength(0);
    expect(has('App')).toBe(false);
  });

  it('rejects missing hosts, uncompiled components, and duplicate roots', () => {
    expect(() => mount('missing', () => undefined)).toThrow(
      /mount target '#missing' was not found/,
    );

    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');
    document.body.append(firstHost, secondHost);
    expect(() => mount(firstHost, () => undefined)).toThrow(
      /not a compiled application root/,
    );

    const component = rootFactory('UniqueRoot');
    const application = mount(firstHost, component);
    mounted.push(application);
    expect(() => mount(secondHost, component)).toThrow(/already mounted/);
    expect(() => mount(firstHost, rootFactory('OtherRoot'))).toThrow(
      /already owns an application/,
    );
  });

  it('derives root metadata from an aliased imported mount component', () => {
    const compiled = compileModulesDetailed({
      './entry.ts': `
        import { mount } from '@memoized-dom/runtime';
        import {App as Application} from './App';
        mount('root', Application);
      `,
      './App.tsx': `
        export function App() {
          return <main>Ready</main>;
        }
      `,
    });

    expect(compiled.applicationRoot).toEqual({
      key: './App.tsx#App',
      moduleId: './App.tsx',
      mountModuleId: './entry.ts',
      local: 'App',
      rootId: 'App',
    });
    expect(compiled.output['./App.tsx']).toContain('registerRootFactory(App');
    expect(compiled.output['./entry.ts']).toContain("mount('root', Application)");
  });

  it.each([
    ['const', "const rendered = start('root', Application);"],
    ['let', "let rendered = start('root', Application);"],
    ['export', "export const rendered = start('root', Application);"],
    ['await', "const rendered = await start('root', Application);"],
    ['typed', "const rendered = start('root', Application) as unknown;"],
    ['multiple declarations', "const unused = 1, rendered = start('root', Application);"],
  ])('recognizes a captured mount in a %s declaration', (_name, entry) => {
    const result = compileModulesDetailed({
      './entry.ts': `import {mount as start} from '@memoized-dom/runtime';
        import { App as Application } from './App';${entry}`,
      './App.tsx': `export function App(){return <main>Ready</main>;}`,
    });
    expect(result.applicationRoot?.key).toBe('./App.tsx#App');
    expect(result.output['./App.tsx']).toContain('registerRootFactory(App');
  });

  it('executes a captured compiled mount and keeps actual nodes across unmount/remount', async () => {
    const runtimePath = '@memoized-dom/runtime/testing';
    const result = compileModulesDetailed({
      './entry.ts': `import {mount} from '${runtimePath}';import {App} from './App';
        export const rendered=mount('root',App);
        export function remount(){return mount('root',App);}`,
      './App.tsx': `export function App(){return <><header>Header</header><main>Ready</main><footer>Footer</footer></>;}`,
    }, {runtimePath});
    const directory = join(import.meta.dirname, 'fixtures/out/mount-captured');
    mkdirSync(directory, {recursive:true});
    for(const [id, code] of Object.entries(result.output)) writeFileSync(join(directory,id),code);
    const host = document.createElement('div');host.id='root';document.body.append(host);
    const entry = await import(/* @vite-ignore */ pathToFileURL(join(directory,'entry.ts')).href);
    const application: MountedApplication = entry.rendered;mounted.push(application);
    expect(application.nodes).toEqual([...host.childNodes]);
    expect(application.nodes).toHaveLength(3);
    expect(application.nodes.every(node=>node instanceof Node && node.isConnected)).toBe(true);
    expect(()=>entry.remount()).toThrow(/already owns an application/);
    application.unmount();
    expect(application.nodes.every(node=>!node.isConnected)).toBe(true);
    expect(host.childNodes).toHaveLength(0);
    const next: MountedApplication=entry.remount();mounted.push(next);
    expect(next.mounted).toBe(true);expect(host.textContent).toBe('HeaderReadyFooter');
    expect(next.nodes).toEqual([...host.childNodes]);
    expect(next.nodes[0]).not.toBe(application.nodes[0]);
  });

  it('rejects ambiguous or non-component mount boundaries', () => {
    expect(() =>
      compileModulesDetailed({
        './entry.ts': `
          import { mount } from '@memoized-dom/runtime';
          import {App} from './App';
          mount('one', App);
          mount('two', App);
        `,
        './App.tsx': `export function App() { return <main />; }`,
      }),
    ).toThrow(/only one top-level mount/);

    expect(() => compileModulesDetailed({
      './entry.ts': `import {mount} from '@memoized-dom/runtime';import { App } from './App';
        const rendered=mount('one',App);mount('two',App);`,
      './App.tsx': `export function App(){return <main/>;}`,
    })).toThrow(/only one top-level mount/);

    expect(() =>
      compileModulesDetailed({
        './entry.ts': `
          import { mount } from '@memoized-dom/runtime';
          import { helper } from './helper';
          mount('root', helper);
        `,
        './helper.ts': `export function helper() { return 1; }`,
      }),
    ).toThrow(/does not resolve to a compiled component/);
  });
});
