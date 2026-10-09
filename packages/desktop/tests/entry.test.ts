import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildDesktopEntry } from '../src/dev/build';
import { createDesktopApplication, runDesktopEntry, mount, type SceneTemplate, type SceneTransaction } from '../src';

describe('authored desktop entries', () => {
  it('builds a component-free TSX utility imported by an authored component', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'memo-desktop-utility-'));
    try {
      await writeFile(resolve(directory, 'utility.tsx'), 'export const label: string = "utility";');
      await writeFile(resolve(directory, 'App.tsx'), 'import {label} from "./utility";export function App(){return <p>{label}</p>;}');
      await writeFile(resolve(directory, 'main.ts'), 'import {mount} from "@memoized-dom/runtime";import {App} from "./App";mount("root",App);');
      const code = await buildDesktopEntry(resolve(directory, 'main.ts'), { runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href });
      const app = createDesktopApplication({ async install() {}, async commit(transaction) { return { sequence: transaction.sequence }; } });
      try { const roots = await runDesktopEntry(app, () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)); expect(roots.get('root')!.mounted).toBe(true); }
      finally { await app.dispose(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
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
    expect(templates).toHaveLength(7);
    expect(templates[0]!.nodes[0]).toMatchObject({ tag: 'div', attributes: { id: 'desktop-page', class: 'desktop-page' } });
    const counter = transactions[0]!.operations.find(operation => operation.kind === 'mount' && operation.template.endsWith('#App'))!;
    expect(templates[0]!.stylesheets!.some(rule => rule.declarations.some(d => d.property === 'flex-direction' && d.value === 'row'))).toBe(true);
    await app.dispatch(counter.handle, 0);
    expect(transactions.at(-1)!.operations[0]).toMatchObject({ kind: 'update', values: [{ value: '1' }] });
    await app.dispatch(counter.handle, 1);
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
