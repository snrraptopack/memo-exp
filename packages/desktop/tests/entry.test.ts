import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDesktopEntry } from '../src/dev/build';
import { createDesktopApplication, runDesktopEntry, mount, type SceneTemplate, type SceneTransaction } from '../src';

describe('authored desktop entries', () => {
  it('builds the real TSX/CSS example and mounts through the normal authored entry', async () => {
    const templates: SceneTemplate[] = [];
    const transactions: SceneTransaction[] = [];
    const code = await buildDesktopEntry(resolve(import.meta.dirname, '../examples/counter/main.ts'), {
      runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href,
    });
    const app = createDesktopApplication({ async install(template) { templates.push(template); }, async commit(transaction) { transactions.push(transaction); return { sequence: transaction.sequence }; } });
    const roots = await runDesktopEntry(app, () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
    const root = roots.get('root')!;
    expect(root.mounted).toBe(true);
    expect(templates).toHaveLength(3);
    expect(templates[0]!.nodes[0]).toMatchObject({ tag: 'main', attributes: { id: 'app', class: 'card' } });
    expect(templates[0]!.stylesheets!.some(rule => rule.declarations.some(d => d.property === 'flex-direction' && d.value === 'row'))).toBe(true);
    await root.dispatch(0);
    expect(transactions.at(-1)!.operations[0]).toMatchObject({ kind: 'update', values: [{ value: '1' }] });
    await root.dispatch(1);
    expect(transactions.at(-1)!.operations[0]).toMatchObject({ kind: 'update', values: [{ value: '0' }] });
    await app.dispose();
    expect(root.mounted).toBe(false);
    await root.unmount();
  });

  it('rejects mount outside an entry and cleans up roots when the entry fails', async () => {
    expect(() => mount('root', () => null)).toThrow('desktop application entry');
    const app = createDesktopApplication({ async install() {}, async commit(t) { return { sequence: t.sequence }; } });
    await expect(runDesktopEntry(app, async () => { throw new Error('entry failed'); })).rejects.toThrow('entry failed');
    expect(() => app.mount(() => null)).toThrow('disposed');
  });
});
