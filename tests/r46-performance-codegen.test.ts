import { describe, expect, it } from 'vitest';
import { compile } from '@memoized-dom/compiler';

describe('R46 performance code generation', () => {
  it('does not invalidate twice after a committed local helper', () => {
    const code = compile(`
      let count = 0;
      function App() {
        const run = () => {
          count++;
        };
        return <button onClick={() => run()}>{count}</button>;
      }
    `);

    expect(code.match(/\.commitWrites\(/g)).toHaveLength(1);
    expect(code).not.toContain('.markDirty(');
  });

  it('retains the event boundary for unknown and deferred-only calls', () => {
    const unknown = compile(`
      let count = 0;
      function App() {
        return <button onClick={() => unknownWork()}>{count}</button>;
      }
    `);
    expect(unknown).toContain('.markDirty(');

    const deferred = compile(`
      let count = 0;
      function App() {
        function runLater() {
          setTimeout(() => {
            count++;
          }, 0);
        }
        return <button onClick={() => runLater()}>{count}</button>;
      }
    `);
    expect(deferred).toContain('.markDirty(');
    expect(deferred).toContain('.commitWrites(');
  });

  it('creates an inline component callback once and replays its identity', () => {
    const code = compile(`
      function Child({ value, onSelect }) {
        return <button onClick={onSelect}>{value}</button>;
      }
      let count = 0;
      function App() {
        return <Child value={count} onSelect={() => {
          count++;
        }} />;
      }
    `);

    const declaration = code.match(
      /const (_onSelectCallback\d*) = \(\) =>/,
    );
    expect(declaration).not.toBeNull();
    expect(code.match(/count\+\+/g)).toHaveLength(1);
    expect(
      code.match(new RegExp(`\\b${declaration![1]}\\b`, 'g'))!.length,
    ).toBeGreaterThan(1);

    const conditional = compile(`
      function Child({ value, onSelect }) {
        return <button onClick={onSelect}>{value}</button>;
      }
      let count = 0;
      let show = true;
      function App() {
        return <main>{show
          ? <Child value={count} onSelect={() => {
              count++;
            }} />
          : null}</main>;
      }
    `);
    expect(conditional).toMatch(
      /const _onSelectCallback\d* = \(\) =>/,
    );
    expect(conditional.match(/count\+\+/g)).toHaveLength(1);
  });

  it('keeps one callback closure per retained component row', () => {
    const code = compile(`
      function Row({ item, onSelect }) {
        return <li><button onClick={onSelect}>{item.id}</button></li>;
      }
      let selected = 0;
      function App() {
        let items = [{ id: 1 }, { id: 2 }];
        return <ul>{items.map((item) =>
          <Row
            key={item.id}
            item={item}
            onSelect={() => {
              selected = item.id;
            }}
          />
        )}</ul>;
      }
    `);

    const declaration = code.match(
      /const (_onSelectCallback\d*) = \(\) =>/,
    );
    expect(declaration).not.toBeNull();
    expect(code.match(/selected = item\.id/g)).toHaveLength(1);
    expect(
      code.match(new RegExp(`\\b${declaration![1]}\\b`, 'g'))!.length,
    ).toBeGreaterThan(1);
  });

  it('refreshes only old/new keys for an exact owner-local row dependency', () => {
    const code = compile(`
      function Row({ item, isSelected }) {
        return <li class={isSelected ? 'danger' : ''}>{item.id}</li>;
      }
      function App() {
        let items = [{ id: 1 }, { id: 2 }];
        let selected = 0;
        return <main>
          <button onClick={() => { selected = 2; }}>select</button>
          <ul>{items.map(item =>
            <Row
              key={item.id}
              item={item}
              isSelected={selected === item.id}
            />
          )}</ul>
        </main>;
      }
    `);

    expect(code.match(/\.refreshKey\(/g)).toHaveLength(2);
    expect(code).toMatch(/\.markDirty\(_id\d*, \d+\)/);
    expect(code).toContain('typeof _reasons');
  });

  it('retains full reconciliation when a row dependency has a general use', () => {
    const code = compile(`
      function Row({ item, selected, isSelected }) {
        return <li>{item.id}:{selected}:{String(isSelected)}</li>;
      }
      function App() {
        let items = [{ id: 1 }, { id: 2 }];
        let selected = 0;
        return <ul>{items.map(item =>
          <Row
            key={item.id}
            item={item}
            selected={selected}
            isSelected={selected === item.id}
          />
        )}</ul>;
      }
    `);

    expect(code).not.toContain('.refreshKey(');
  });

  it('journals direct non-key item writes and keeps structural writes full', () => {
    const code = compile(`
      function Row({ item }) {
        return <li>{item.label}</li>;
      }
      function Controls({ dispatch }) {
        return <button onClick={() => dispatch({ type: 'UPDATE' })}>update</button>;
      }
      function App() {
        let items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
        const dispatch = action => {
          switch (action.type) {
            case 'UPDATE':
              for (let i = 0; i < items.length; i += 10) {
                items[i].label += '!';
              }
              break;
            case 'CLEAR':
              items = [];
              break;
          }
        };
        return <main>
          <Controls dispatch={dispatch} />
          <ul>{items.map(item =>
            <Row key={item.id} item={item} />
          )}</ul>
        </main>;
      }
    `);

    const journal = code.match(/const (_itemsChangedKeys\d*) = new Set/);
    expect(journal).not.toBeNull();
    expect(code).toContain(`${journal![1]}.add(items[i].id)`);
    expect(code).toContain(`for (const _changedListKey of ${journal![1]})`);
    expect(code).toContain(`${journal![1]}.clear()`);
    expect(code).toContain('.reconcile(items)');
  });

  it('uses topology-only reconciliation for known array mutations', () => {
    const code = compile(`
      function Row({ item }) {
        return <li>{item.label}</li>;
      }
      function App() {
        let items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
        const dispatch = action => {
          if (action === 'SWAP') items.splice(0, 2, items[1], items[0]);
          if (action === 'REPLACE') items = [{ id: 1, label: 'new' }];
          if (action === 'UPDATE') items[0].label += '!';
        };
        return <ul>{items.map(item =>
          <Row key={item.id} item={item} />
        )}</ul>;
      }
    `);

    expect(code).toContain('.reconcile(items, false)');
    expect(code).toContain('.reconcile(items)');
    expect(code).toContain('.refreshKey(');
  });

  it('retains full reconciliation when a row consumes the map index', () => {
    const code = compile(`
      function Row({ item, index }) {
        return <li>{index}:{item.label}</li>;
      }
      function App() {
        let items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }];
        const swap = () => items.reverse();
        return <ul>{items.map((item, index) =>
          <Row key={item.id} item={item} index={index} />
        )}</ul>;
      }
    `);

    expect(code).not.toContain('.reconcile(items, false)');
    expect(code).toContain('.reconcile(items)');
  });
});
