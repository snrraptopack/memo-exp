import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { createProcessHost } from '../src/bridge/process';
import { createDesktopApplication, mountScene, sceneEvent, type SceneInstance, type SceneTemplate } from '../src';

const executable = resolve(import.meta.dirname, '../rust/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host');
const template: SceneTemplate = { id: 'host-counter', nodes: [
  { kind: 'element', tag: 'button', parent: null, text: '' }, { kind: 'text', parent: 0, text: '' },
], slots: [{ node: 1, type: 'text' }], events: [{ node: 0, type: 'click' }] };

describe('Rust retained scene bridge', () => {
  it('preserves native branch records on rejection and replaces the whole subtree on retry', async () => {
    const {code}=compileDesktop(`function Leaf({value}){return <p>{value}</p>;}function A(){return <section><Leaf value="A"/></section>;}function B(){return <section><Leaf value="B"/></section>;}export function App(){let shown=true;return <main><button onClick={()=>shown=!shown}>Toggle</button>{shown?<A/>:<B/>}</main>;}`,
      {moduleId:'native-region.tsx',runtimePath:pathToFileURL(resolve(import.meta.dirname,'../src/index.ts')).href});
    const compiled=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as {App():SceneInstance};
    const host=createProcessHost({executable});let reject=true;
    const app=createDesktopApplication({install:template=>host.install(template),async commit(transaction){
      if(transaction.sequence===2&&reject){reject=false;const operations=transaction.operations.map(operation=>operation.kind==='mount'?{...operation,values:[{slot:999,value:'invalid'}]}:operation);return host.commit({...transaction,operations});}
      return host.commit(transaction);
    }});
    try {
      const root=app.mount(compiled.App);await root.ready;const before=await host.inspect();
      const error=await root.dispatch(0).then(()=>undefined,error=>error as Error);
      expect(error).toBeInstanceOf(Error);expect(await host.inspect()).toEqual(before);
      await root.flush();const after=await host.inspect();expect(after.sequence).toBe(2);expect(after.instances).toHaveLength(3);
      expect(after.instances[0]!.handle).toEqual(root.handle);
      expect(after.instances.slice(1).every(instance=>before.instances.slice(1).every(old=>old.handle.id!==instance.handle.id))).toBe(true);
      expect(after.instances[2]!.text_groups[0]!.text).toBe('B');
      expect(after.instances[2]!.attach_to!.handle).toEqual(after.instances[1]!.handle);
      await app.dispose();expect(await host.inspect()).toEqual({sequence:3,instances:[]});
    } finally {await app.dispose();await host.close();}
  });
  it('publishes compiled fragment children and grandchild props atomically and cascades retirement', async () => {
    const { code }=compileDesktop(`
      function Leaf({value}){return <><p>{value}</p><button>Last</button></>;}
      function Child(props){let clicks=0;return <section><button onClick={()=>clicks++}>Clicks: {clicks}</button><Leaf value={props.count}/></section>;}
      export function App(){let count=0;return <main><button onClick={()=>count++}>{count}</button><Child count={count}/></main>;}
    `,{moduleId:'native-tree.tsx',runtimePath:pathToFileURL(resolve(import.meta.dirname,'../src/index.ts')).href});
    const compiled=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as {App():SceneInstance};
    const host=createProcessHost({executable}); const app=createDesktopApplication(host);
    try {
      const root=app.mount(compiled.App); await root.ready;
      const before=await host.inspect(); expect(before.sequence).toBe(1); expect(before.instances).toHaveLength(3);
      const child=before.instances[1]!; const leaf=before.instances[2]!;
      expect(child.attach_to!.handle).toEqual(root.handle); expect(leaf.attach_to!.handle).toEqual(child.handle);
      expect(leaf.presentation.filter(item=>item.parent===null)).toHaveLength(2);
      expect(leaf.text_groups.map(group=>group.text)).toEqual(['0','Last']);
      await app.dispatch(child.handle,0); await root.dispatch(0);
      const after=await host.inspect(); expect(after.sequence).toBe(3);
      expect(after.instances.map(instance=>instance.handle)).toEqual(before.instances.map(instance=>instance.handle));
      expect(after.instances[1]!.text_groups[0]!.text).toBe('Clicks: 1');
      expect(after.instances[2]!.text_groups.map(group=>group.text)).toEqual(['1','Last']);
      expect(after.instances[2]!.text_groups[1]!.revision).toBe(leaf.text_groups[1]!.revision);
      await root.dispose(); expect(await host.inspect()).toEqual({sequence:4,instances:[]});
    } finally { await app.dispose(); await host.close(); }
  });
  it('publishes and retires multiple runtime owners in atomic native batches', async () => {
    const host = createProcessHost({ executable });
    const app = createDesktopApplication(host);
    const owner = () => app.mount(() => {
      let count = 0;
      return mountScene(template, [{ slot: 0, sources: ['count'], read: () => count }], [sceneEvent(() => count++, ['count'])]);
    });
    try {
      const a = owner(); const b = owner();
      await Promise.all([a.ready, b.ready]);
      const before = await host.inspect();
      expect(before.sequence).toBe(1);
      expect(before.instances.map(instance => instance.texts[1])).toEqual(['0', '0']);
      await Promise.all([a.dispatch(0), b.dispatch(0)]);
      const after = await host.inspect();
      expect(after.sequence).toBe(2);
      expect(after.instances.map(instance => instance.texts[1])).toEqual(['1', '1']);
      expect(after.instances.map(instance => instance.handle)).toEqual(before.instances.map(instance => instance.handle));
      await app.dispose();
      expect(await host.inspect()).toEqual({ sequence: 3, instances: [] });
    } finally { await app.dispose(); await host.close(); }
  });
  it('translates authored div, p, span and button in Rust and retains paragraph identity', async () => {
    const { code } = compileDesktop(`export function Counter() {
      let count = 0;
      return <div>
        <p>Count: <span>{count}</span></p>
        <p>Unchanged &amp; 🙂</p>
        <button onClick={() => count++}>Increment</button>
      </div>;
    }`, { moduleId: 'tag-counter.tsx', runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href });
    const compiled = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as { Counter(): SceneInstance };
    const host = createProcessHost({ executable });
    try {
      const app = createDesktopApplication(host);
      const counter = app.mount(compiled.Counter);
      await counter.ready;
      const before = (await host.inspect()).instances[0]!;
      expect(before.text_groups).toEqual([
        { text: 'Count: 0', revision: 1 }, { text: 'Unchanged & 🙂', revision: 1 }, { text: 'Increment', revision: 1 },
      ]);
      await counter.dispatch(0);
      const after = (await host.inspect()).instances[0]!;
      expect(after.handle).toEqual(before.handle);
      expect(after.presentation).toEqual(before.presentation);
      expect(after.text_groups).toEqual([
        { text: 'Count: 1', revision: 2 }, { text: 'Unchanged & 🙂', revision: 1 }, { text: 'Increment', revision: 1 },
      ]);
      await app.dispose();
    } finally { await host.close(); }
  });

  it('rejects an unsupported authored tag at native template installation', async () => {
    const { code } = compileDesktop('export function Counter(){ return <div><img /></div>; }', {
      moduleId: 'unsupported-tag.tsx', runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href,
    });
    const compiled = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as { Counter(): SceneInstance };
    const host = createProcessHost({ executable });
    try {
      const app = createDesktopApplication(host);
      const counter = app.mount(compiled.Counter);
      const error = await counter.ready.then(() => { throw new Error('Expected native tag rejection'); }, (error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Unsupported desktop tag <img>');
      expect((await host.inspect()).instances).toHaveLength(0);
      await app.dispose();
    } finally { await host.close(); }
  });

  it('publishes Bun state into persistent Rust scene records and disposes them', async () => {
    const host = createProcessHost({ executable });
    try {
      const app = createDesktopApplication(host);
      const counter = app.mount(() => {
        let count = 0;
        return mountScene(template, [{ slot: 0, sources: ['count'], read: () => count }],
          [sceneEvent(() => count++, ['count'])]);
      });
      await counter.ready;
      const initial = await host.inspect();
      expect(initial.instances[0]!.texts).toEqual(['', '0']);
      await counter.dispatch(0);
      const updated = await host.inspect();
      expect(updated.instances).toHaveLength(1);
      expect(updated.instances[0]!.handle).toEqual(initial.instances[0]!.handle);
      expect(updated.instances[0]!.texts).toEqual(['', '1']);
      await app.dispose();
      expect((await host.inspect()).instances).toHaveLength(0);
    } finally { await host.close(); }
  });

  it('rejects a partial transaction and accepts a corrected retry at the same sequence', async () => {
    const host = createProcessHost({ executable });
    const handle = { id: 1, generation: 1 };
    try {
      await host.install(template);
      await host.commit({ sequence: 1, operations: [{ kind: 'mount', handle, template: template.id, values: [{ slot: 0, value: '0' }] }] });
      const before = await host.inspect();
      const rejected = await host.commit({ sequence: 2, operations: [
        { kind: 'update', handle, values: [{ slot: 0, value: '1' }] },
        { kind: 'update', handle, values: [{ slot: 99, value: 'bad' }] },
      ] }).then(() => { throw new Error('Expected scene rejection'); }, (error: unknown) => error);
      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).message).toContain('Unknown scene slot');
      expect(await host.inspect()).toEqual(before);
      await host.commit({ sequence: 2, operations: [{ kind: 'update', handle, values: [{ slot: 0, value: '1' }] }] });
      expect((await host.inspect()).instances[0]!.texts[1]).toBe('1');
    } finally { await host.close(); }
  });
});
