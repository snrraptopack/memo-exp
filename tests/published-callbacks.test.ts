import { compileModules } from '@memoized-dom/compiler';
import { describe, expect, it } from 'bun:test';

function output(
  callback = 'const select = id => { selected = id; };',
  extra = '',
) {
  return compileModules({
    './row.tsx': `export function Row(props) {
      return <li class={props.active ? 'danger' : ''} onClick={() => props.select(props.item.id)}>{props.item.id}</li>;
    }`,
    './app.tsx': `import { Row } from './row';
      export function App() {
        let items = [{id: 1}, {id: 2}]; let selected = null;
        ${callback}
        return <main><ul>{items.map(item => <Row key={item.id} item={item} active={selected === item.id} select={select}/>)}</ul>${extra}</main>;
      }`,
  });
}

describe('published component callbacks', () => {
  it('drops the duplicate child/root refresh for a proven owner callback across files', () => {
    const compiled = output();
    expect(compiled['./row.tsx']).not.toContain('.markDirtySubtree(');
    expect(compiled['./app.tsx']).toContain('.refreshKey(');
    expect(compiled['./app.tsx']).toMatch(/\.markDirty\(/);
  });

  it.each([
    'const apply = id => { selected = id; }; const select = id => apply(id);',
    'const apply = id => { selected = id; }; const forward = id => { return apply(id); }; const select = id => forward(id);',
    'const select = id => apply(id); const apply = id => { selected = id; };',
  ])('proves synchronous local forwarding by lexical binding: %s', callback => {
    const compiled = output(callback);
    expect(compiled['./row.tsx']).not.toContain('.markDirtySubtree(');
    expect(compiled['./app.tsx']).toContain('.refreshKey(');
  });

  it.each([
    'let apply = id => { selected = id; }; const select = id => apply(id);',
    'const apply = async id => { selected = id; }; const select = id => apply(id);',
    'const apply = id => external(id); const select = id => apply(id);',
    'const apply = item => { item.id = 3; }; const select = id => apply(id);',
    'const apply = id => { selected = id; }; const select = apply => apply(1);',
    'const apply = id => { selected = id; }; const select = id => apply(external(id));',
    'const apply = id => { selected = id; }; const select = id => apply(id.value);',
    'const apply = id => { selected = id; }; const select = id => apply(...id);',
    'const apply = id => { selected = id; }; const select = id => apply?.(id);',
    'const apply = (id = external()) => { selected = id; }; const select = () => apply();',
    'const apply = id => { selected = id; }; const select = id => apply(unknownGlobal);',
    'const apply = id => forward(id); const forward = id => apply(id); const select = id => apply(id);',
  ])('keeps unproven forwarding conservative: %s', callback => {
    expect(output(callback)['./row.tsx']).toContain('.markDirtySubtree(');
  });

  it.each([
    'const select = id => external(id);',
    'const select = async id => { selected = id; };',
    'let select = id => { selected = id; };',
    'const select = item => { item.id = 3; };',
    'const select = id => { throw new Error("failure"); };',
  ])(
    'keeps unknown, deferred, mutable and argument-mutating callbacks conservative: %s',
    (callback) => {
      expect(output(callback)['./row.tsx']).toContain('.markDirtySubtree(');
    },
  );

  it('requires proof from every caller, including omitted props', () => {
    expect(
      output(
        undefined,
        '<ul>{items.map(item => <Row key={item.id} item={item} select={external}/>)}</ul>',
      )['./row.tsx'],
    ).toContain('.markDirtySubtree(');
    expect(
      output(
        undefined,
        '<ul>{items.map(item => <Row key={item.id} item={item}/>)}</ul>',
      )['./row.tsx'],
    ).toContain('.markDirtySubtree(');
  });

  it('merges identical guarded owner/root commits after a swap', () => {
    const code = compileModules({
      './app.tsx': `export function App() {
      let items = [{id:1}, {id:2}];
      const swap = () => { const first = items[0]; items[0] = items[1]; items[1] = first; };
      return <main><Controls run={swap}/><ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul></main>;
    }
    function Controls({run}) { return <button onClick={() => run()}>swap</button>;
    }`,
    })['./app.tsx']!;
    expect(code.match(/\.markDirtySubtree\(/g)).toHaveLength(1);
    expect(code).toMatch(/if \(_didWrite\d* \|\| _didWrite\d*\)/);
  });
});
