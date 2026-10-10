import { expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDesktopEntry } from '../src/dev/build';
import { createDesktopApplication, runDesktopEntry, type SceneTemplate, type SceneHandle } from '../src';
import { createProcessHost } from '../src/bridge/process';

it('runs the authored todo through normal mount, keyed rows, parent callbacks, and native scene transactions', async () => {
  const templates = new Map<string, SceneTemplate>();
  const host = createProcessHost({ executable: resolve(import.meta.dirname, '../rust/target/debug', process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host') });
  const app = createDesktopApplication({ async install(template) { templates.set(template.id, template); await host.install(template); }, commit: transaction => host.commit(transaction) });
  try {
    const code = await buildDesktopEntry(resolve(import.meta.dirname, '../examples/todo/main.ts'), { runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href });
    const roots = await runDesktopEntry(app, () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
    const root = roots.get('root')!;
    let snapshot = await host.inspect();
    const rows = () => snapshot.instances.filter(instance => instance.template.endsWith('#TodoRow'));
    const event = (id: string, handle: SceneHandle = root.handle) => {
      const instance = snapshot.instances.find(instance => instance.handle.id === handle.id)!;
      const template = templates.get(instance.template)!;
      const node = template.nodes.findIndex(node => node.kind === 'element' && node.attributes?.id === id);
      const site = template.events.findIndex(event => event.node === node);
      if (site < 0) throw new Error('Missing authored todo event: '+id);
      return site;
    };
    const click = async (id: string, handle: SceneHandle = root.handle) => { await app.dispatch(handle, event(id, handle)); snapshot = await host.inspect(); };
    expect(rows()).toHaveLength(3);
    await click('add-task'); expect(rows()).toHaveLength(3);
    await app.dispatch(root.handle, event('new-task'), { target: {value:'  New task 🙂  '}, currentTarget: {value:'  New task 🙂  '} });
    await click('add-task'); expect(rows()).toHaveLength(4);
    const added = rows().find(row => row.text_groups.some(group => group.text === 'Task #4'))!;
    expect(snapshot.instances.some(instance => instance.text_groups.some(group => group.text === 'New task 🙂'))).toBe(true);
    await click('toggle-task', added.handle);
    expect(snapshot.instances.some(instance => instance.template.endsWith('#CompletedTitle') && instance.attach_to?.handle.id === added.handle.id)).toBe(true);
    await click('toggle-task', added.handle);
    await app.dispatch(added.handle, event('row-note', added.handle), {target:{value:'Keep this note'},currentTarget:{value:'Keep this note'}});
    await click('reverse-tasks');
    expect(rows().find(row => row.handle.id === added.handle.id)?.text_groups.some(group => group.text === 'Note: Keep this note')).toBe(true);
    await click('delete-task', added.handle); expect(rows()).toHaveLength(3);
    await expect(app.dispatch(added.handle, 0)).rejects.toThrow('retired owner');
    await click('filter-done'); expect(rows()).toHaveLength(1);
    await click('filter-active'); expect(rows()).toHaveLength(2);
    await click('filter-all'); await click('clear-done'); expect(rows()).toHaveLength(2);
    for (const row of rows()) await click('delete-task', row.handle);
    expect(rows()).toHaveLength(0);
    expect(snapshot.instances.some(instance => instance.template.endsWith('#EmptyTasks'))).toBe(true);
    await click('add-samples'); expect(rows()).toHaveLength(20);
    expect(snapshot.instances.some(instance => instance.template.endsWith('#EmptyTasks'))).toBe(false);
  } finally { await app.dispose(); await host.close(); }
});
