import { describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';

describe('linker identifier lifecycle', () => {
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
