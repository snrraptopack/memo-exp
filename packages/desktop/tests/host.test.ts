import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { createProcessHost } from '../src/bridge/process';
import { createDesktopApplication, mountScene, sceneEvent, type SceneTemplate } from '../src';

const executable = resolve(import.meta.dirname, '../rust/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host');
const template: SceneTemplate = { id: 'host-counter', nodes: [
  { kind: 'button', parent: null, text: '' }, { kind: 'text', parent: 0, text: '' },
], slots: [{ node: 1, type: 'text' }], events: [{ node: 0, type: 'click' }] };

describe('Rust retained scene bridge', () => {
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
