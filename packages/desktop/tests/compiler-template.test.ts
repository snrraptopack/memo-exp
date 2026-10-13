import { describe, expect, test } from 'bun:test';
import { printEstree } from '../../compiler/src/ast';
import type { HostAttributeStep, HostTextStep } from '../../compiler/src/desktop/template-plan';
import type { Template } from '../src/host/protocol';
import { sourceTemplate } from './fixtures/native-template';

function expression(step: HostTextStep): string {
  return printEstree(step.expression).code;
}

describe('native templates lower existing JSX/source plans', () => {
  test('retains fragment roots and pre-order addresses without wrapper elements', () => {
    const { plan, program, before } = sourceTemplate(
      'export function App(){return <><main><h1>Title</h1><p>Text</p></main><footer>End</footer></>}',
      'fragments',
    );
    const template: Template = plan.template;

    expect(template.nodes.map(source => source.parent)).toEqual([null, 0, 1, 0, 3, null, 5]);
    expect(plan.steps).toEqual([]);
    expect(JSON.stringify(program)).toBe(before);
    expect(Object.isFrozen(template)).toBe(true);
    expect(Object.isFrozen(template.nodes)).toBe(true);
    expect(template.nodes.every(source => Object.isFrozen(source) && Object.isFrozen(source.node))).toBe(true);
  });

  test('uses the shared namespace classifier including foreignObject and SVG leaf roots', () => {
    const { plan } = sourceTemplate(
      'export function App(){return <><svg><g><path/><foreignObject><div>HTML</div></foreignObject></g></svg><circle/></>}',
      'namespaces',
    );
    const elements = plan.template.nodes.flatMap(source =>
      source.node.kind === 'element' ? [source.node.name] : []);

    expect(elements.map(name => [name.local, name.namespace])).toEqual([
      ['svg', 'http://www.w3.org/2000/svg'],
      ['g', 'http://www.w3.org/2000/svg'],
      ['path', 'http://www.w3.org/2000/svg'],
      ['foreignObject', 'http://www.w3.org/2000/svg'],
      ['div', 'http://www.w3.org/1999/xhtml'],
      ['circle', 'http://www.w3.org/2000/svg'],
    ]);
  });

  test('preserves ordered attributes/spreads and locates events/refs without serializing them', () => {
    const { plan } = sourceTemplate(`
      export function App(){
        let input;
        return <main title={first()}>
          <input onInput={early} {...props()} ref={input} onInput={late} class="field" />
          <p>{last()}</p>
        </main>;
      }
    `, 'ordered');
    expect(plan.steps.map(step => [step.kind, step.source])).toEqual([
      ['attributes', 0], ['attributes', 1], ['text', 3],
    ]);
    const input = plan.steps[1] as HostAttributeStep;

    expect(input.plan.entries.map(entry => entry.type === 'spread' ? 'spread' : entry.name)).toEqual([
      'onInput', 'spread', 'ref', 'onInput', 'class',
    ]);
    expect(input.plan.safeEventKeys).toEqual(['onInput']);
    expect(plan.events).toEqual([
      { source: 1, entry: 0, name: 'onInput' }, { source: 1, entry: 3, name: 'onInput' },
    ]);
    expect(plan.refs).toEqual([{ source: 1, entry: 2 }]);
    expect(plan.template.nodes.filter(source => source.node.kind === 'element')
      .every(source => source.node.kind === 'element' && source.node.attributes.length === 0)).toBe(true);
  });

  test('uses shared literal decoding and preserves opaque text joins without running code', () => {
    const { plan } = sourceTemplate(`
      export function App(){return <main title="A &amp; B">
        <p>A&nbsp;&nbsp;B &amp;amp;</p><span>{one()}{two()}</span>
      </main>}
    `, 'text');
    const attribute = plan.steps[0] as HostAttributeStep;
    const entry = attribute.plan.entries[0]!;

    expect(entry.type).toBe('attribute');
    expect(printEstree(entry.value).code).toBe('"A & B"');
    expect(plan.template.nodes).toContainEqual({ parent: 1, node: { kind: 'text', value: 'A\u00a0\u00a0B &amp;' } });
    const text = plan.steps.find(step => step.kind === 'text') as HostTextStep;
    expect(expression(text)).toBe('"" + one() + two()');
    expect(text.sources).toBeNull();
  });

  test('keeps exact instance sources and conservative module sources from core analysis', () => {
    const { plan } = sourceTemplate(`
      let shared=0;
      export function App(){let local=0;const change=()=>{local++;shared++;};
        return <main><p>{local}</p><p>{shared}</p><button onClick={change}>Change</button></main>}
    `, 'sources');
    const text = plan.steps.filter(step => step.kind === 'text');

    expect(text.map(step => step.sources)).toEqual([['local'], null]);
  });

  test('retains component, conditional, list and forwarded child plans as native regions', () => {
    const { plan } = sourceTemplate(`
      function Child(){return <span>Child</span>}
      export function App({children}){let shown=true;let rows=[1];
        return <main><Child/>{shown && <b>Shown</b>}{rows.map(row => <p key={row}>{row}</p>)}{children}<i>End</i></main>
      }
    `, 'regions', ['children']);
    const regions = plan.steps.filter(step => step.kind === 'region');

    expect(regions.map(step => [step.source, step.content.type])).toEqual([
      [1, 'component'], [2, 'condition'], [3, 'list'], [4, 'slot'],
    ]);
    expect(plan.template.nodes.slice(1, 5).every(source =>
      source.parent === 0 && source.node.kind === 'comment')).toBe(true);
    expect(plan.template.nodes[5]).toMatchObject({ parent: 0, node: { kind: 'element', name: { local: 'i' } } });
  });

  test('does not pretend member components or dynamic tag bindings are HTML tags', () => {
    const { plan } = sourceTemplate(
      'export function App({Tag}){return <main><Tag/><UI.Label/></main>}',
      'dynamic',
    );

    expect(plan.steps.map(step => step.kind)).toEqual(['region', 'region']);
    expect(plan.template.nodes.filter(source => source.node.kind === 'element')).toHaveLength(1);
  });

  test('rejects unresolved namespace spelling and JSX-valued text with source locations', () => {
    expect(() => sourceTemplate('export function App(){return <svg:path/>}', 'unresolved'))
      .toThrow('explicit resolved namespace');
    expect(() => sourceTemplate('export function App(){return <div>{<span/>}</div>}', 'unresolved'))
      .toThrow('shared source normalization');
  });
});
