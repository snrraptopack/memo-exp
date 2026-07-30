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
});
