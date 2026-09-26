import { describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';

describe('linker identifier lifecycle', () => {
  it('links named component reexports through a barrel and erases type-only reexports', () => {
    const output = compileModules({
      './Inner.tsx': `export function Badge({ label }) { return <span>{label}</span>; }`,
      './types.ts': `export interface BadgeOptions { label: string }`,
      './barrel.ts': `export { Badge as Label } from './Inner';
        export type { BadgeOptions } from './types';`,
      './App.tsx': `import { Label } from './barrel';
        export function App() { return <div><Label label="ready" /></div>; }`,
    });
    expect(output['./App.tsx']).toContain('Label(');
    expect(output['./barrel.ts']).not.toContain('BadgeOptions');
    expect(output['./barrel.ts']).toContain('export { __mmdReexport0 as Label }');
  });

  it('links MMD components and values through star-export barrels', () => {
    const output = compileModules({
      './Inner.tsx': `
        export const label = 'ready';
        export function Badge({ text }) { return <span>{text}</span>; }
        export default 'hidden';
      `,
      './types.ts': `export interface BadgeOptions { text: string }`,
      './middle.ts': `export * from './Inner'; export type * from './types';`,
      './barrel.ts': `export * from './middle';`,
      './App.tsx': `import { Badge, label } from './barrel';
        export function App() { return <div><Badge text={label} /></div>; }`,
    });
    expect(output['./App.tsx']).toContain('Badge(');
    expect(output['./barrel.ts']).toContain('as Badge');
    expect(output['./barrel.ts']).toContain('as label');
    expect(output['./barrel.ts']).not.toContain('as default');
    expect(output['./middle.ts']).not.toContain('BadgeOptions');
  });

  it('lets an explicit MMD reexport override a star-exported name', () => {
    const output = compileModules({
      './Preferred.tsx': `export function Badge() { return <strong>preferred</strong>; }`,
      './Other.tsx': `export function Badge() { return <em>other</em>; }`,
      './barrel.ts': `export { Badge } from './Preferred'; export * from './Other';`,
      './App.tsx': `import { Badge } from './barrel';
        export function App() { return <Badge />; }`,
    });
    expect(output['./App.tsx']).toContain('Badge(');
    expect(output['./barrel.ts']).not.toMatch(/import\s*\{[^}]*Badge[^}]*\}\s*from ['"]\.\/Other['"]/);
  });

  it('diagnoses an ambiguous MMD star-exported component', () => {
    expect(() => compileModules({
      './First.tsx': `export function Badge() { return <strong>first</strong>; }`,
      './Second.tsx': `export function Badge() { return <em>second</em>; }`,
      './barrel.ts': `export * from './First'; export * from './Second';`,
      './App.tsx': `import { Badge } from './barrel';
        export function App() { return <Badge />; }`,
    })).toThrow("ambiguous star export 'Badge'");
  });

  it('initializes generated identifiers before manifest analysis', () => {
    const output = compileModules(
      {
        './model.ts': `
          export function select(items) {
            return items.filter(item => item.visible);
          }

          export function summarize(items) {
            return items.filter(item => item.visible).length;
          }
        `,
        './entry.ts': `
          import { mount } from '@memoized-dom/runtime';
          import { App } from './App';
          mount('root', App);
        `,
        './App.tsx': `
          import { select, summarize } from './model';

          const store = {
            items: [{ id: 1, label: 'one', visible: true }],
            view: 'items',
          };

          function Row({ item }) {
            return <li>{item.label}</li>;
          }

          function ItemView({ items }) {
            const visible = select(items);
            return <ul>
              {visible.map(item => <Row key={item.id} item={item} />)}
            </ul>;
          }

          function ReportView({ items }) {
            const total = summarize(items);
            return <strong>{total}</strong>;
          }

          export function App() {
            return <main>
              {store.view === 'items'
                ? <ItemView items={store.items} />
                : <ReportView items={store.items} />}
            </main>;
          }
        `,
      },
    );

    expect(output['./App.tsx']).toContain('registerRootFactory');
    expect(output['./App.tsx']).toContain('"App"');
  });
});
