import { describe, expect, it } from 'bun:test';
import {
  claimHydrationRoot,
  HydrationMismatchError,
  HydrationMarkerIndex,
  HydrationNodePlan,
  parseHydrationMarker,
} from '../packages/runtime/src/hydration';

function hostWith(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('hydration creation plan', () => {
  it('parses v0.2 opens, uniform closes, row keys, and dev attributes', () => {
    expect(parseHydrationMarker('mmd:r:App')).toEqual({
      type: 'open',
      kind: 'r',
      identity: 'App',
    });
    expect(parseHydrationMarker('mmd:w:App/items:s:first')).toEqual({
      type: 'open',
      kind: 'w',
      identity: 'App/items:s:first',
    });
    expect(
      parseHydrationMarker('mmd:g:App/when0 @ src/App.tsx:42:5'),
    ).toEqual({
      type: 'open',
      kind: 'g',
      identity: 'App/when0',
      attribute: 'src/App.tsx:42:5',
    });
    expect(parseHydrationMarker('/mmd')).toEqual({ type: 'close' });
    expect(parseHydrationMarker('ordinary comment')).toBeNull();
    expect(parseHydrationMarker('mmd:q:unknown')).toBeNull();
  });

  it('claims a matching root node without creating or replacing it', () => {
    const host = hostWith(
      '<!--mmd:r:App--><main><h1>Hello</h1></main><!--/mmd-->',
    );
    const original = host.querySelector('main')!;
    const plan = new HydrationNodePlan(claimHydrationRoot(host, 'App'));
    expect(plan.claimNode({ nodeType: 3 })).toBe(original.querySelector('h1')!.firstChild);
    expect(plan.claimNode({ nodeType: 1, tagName: 'h1' })).toBe(original.querySelector('h1'));
    const adopted = plan.claimNode({
      nodeType: 1,
      tagName: 'main',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
    });

    expect(adopted).toBe(original);
    plan.expectDone();
    expect(host.querySelector('main')).toBe(original);
  });

  it('claims nested structural ranges and accepts empty regions', () => {
    const host = hostWith(
      '<!--mmd:r:App-->' +
        '<!--mmd:g:App/when0--><span>ready</span><!--/mmd-->' +
        '<!--mmd:g:App/when1--><!--/mmd-->' +
        '<!--/mmd-->',
    );
    const root = claimHydrationRoot(host, 'App');
    const index = new HydrationMarkerIndex(root);
    const active = new HydrationNodePlan(index.claimRange('g', 'App/when0'));
    active.claimNode({ nodeType: 3 });
    const span = active.claimNode({ nodeType: 1, tagName: 'span' });
    expect(span).toBe(host.querySelector('span'));
    expect(span.textContent).toBe('ready');
    active.expectDone();

    const empty = new HydrationNodePlan(index.claimRange('g', 'App/when1'));
    expect(empty.done).toBe(true);
    empty.expectDone();
    new HydrationNodePlan(root).expectDone();
    expect(index.unclaimed).toBe(0);
  });

  it('bounds v0.2 single-opening rows at the next row or list close', () => {
    const host = hostWith(
      '<!--mmd:r:App-->' +
        '<!--mmd:l:App/items-->' +
        '<!--mmd:w:App/items:s:first--><li>Alpha</li>' +
        '<!--mmd:g:App/items/when0--><span>nested</span><!--/mmd-->' +
        '<!--mmd:w:App/items:n:42--><li>Beta</li>' +
        '<!--/mmd-->' +
        '<!--/mmd-->',
    );
    const root = claimHydrationRoot(host, 'App');
    const index = new HydrationMarkerIndex(root);
    const list = index.claimRange('l', 'App/items');
    const first = index.claimRow('App/items', 's:first');
    const second = index.claimRow('App/items', 'n:42');
    expect(first.end).toBe(second.open);
    expect(second.end).toBe(list.end);
    const firstPlan = new HydrationNodePlan(first);
    firstPlan.claimNode({ nodeType: 3 });
    const alpha = firstPlan.claimNode({ nodeType: 1, tagName: 'li' });
    expect(alpha).toBe(host.querySelectorAll('li')[0]);
    expect(alpha.textContent).toBe('Alpha');
    firstPlan.expectDone();
    expect(() => firstPlan.claimNode({ nodeType: 1, tagName: 'li' })).toThrow(HydrationMismatchError);

    const nested = new HydrationNodePlan(index.claimRange('g', 'App/items/when0'));
    nested.claimNode({ nodeType: 3 });
    const span = nested.claimNode({ nodeType: 1, tagName: 'span' });
    expect(span.textContent).toBe('nested');
    nested.expectDone();

    const secondPlan = new HydrationNodePlan(second);
    secondPlan.claimNode({ nodeType: 3 });
    const beta = secondPlan.claimNode({ nodeType: 1, tagName: 'li' });
    expect(beta).toBe(host.querySelectorAll('li')[1]);
    expect(beta.textContent).toBe('Beta');
    secondPlan.expectDone();
    new HydrationNodePlan(list).expectDone();
    new HydrationNodePlan(root).expectDone();
    expect(index.unclaimed).toBe(0);
  });

  it('serves ordinary nodes in compiler post-order and skips nested ranges', () => {
    const host = hostWith(
      '<!--mmd:r:App-->' +
        '<section>' +
        '<button><span>Count</span></button>' +
        '<!--mmd:g:App/when0--><p>branch</p><!--/mmd-->' +
        '<ul><!--mmd:l:App/items-->' +
        '<!--mmd:w:App/items:n:1--><li>one</li>' +
        '<!--/mmd--></ul>' +
        '</section>' +
        '<!--/mmd-->',
    );
    const text = host.querySelector('span')!.firstChild!;
    const span = host.querySelector('span')!;
    const button = host.querySelector('button')!;
    const list = host.querySelector('ul')!;
    const section = host.querySelector('section')!;
    const plan = new HydrationNodePlan(claimHydrationRoot(host, 'App'));

    expect(plan.claimNode({ nodeType: 3 })).toBe(text);
    expect(plan.claimNode({ nodeType: 1, tagName: 'span' })).toBe(span);
    expect(plan.claimNode({ nodeType: 1, tagName: 'button' })).toBe(button);
    // Conditional and row content are excluded; their primitives own plans.
    expect(plan.claimNode({ nodeType: 1, tagName: 'ul' })).toBe(list);
    expect(plan.claimNode({ nodeType: 1, tagName: 'section' })).toBe(section);
    expect(plan.remaining).toBe(0);
    plan.expectDone();
  });

  it('keeps a failed post-order claim at its bounded position', () => {
    const host = hostWith(
      '<!--mmd:r:App--><section><button>go</button></section><!--/mmd-->',
    );
    const plan = new HydrationNodePlan(claimHydrationRoot(host, 'App'));

    expect(() =>
      plan.claimNode({ nodeType: 1, tagName: 'button' }),
    ).toThrow('expected element <button>, found a text node');
    expect(plan.remaining).toBe(3);
    expect(plan.claimNode({ nodeType: 3 }).textContent).toBe('go');
  });

  it('indexes nested ranges by canonical identity independent of DOM depth', () => {
    const host = hostWith(
      '<!--mmd:r:App--><section>' +
        '<!--mmd:g:App/when0--><p>branch</p><!--/mmd-->' +
        '<ul><!--mmd:l:App/items-->' +
        '<!--mmd:w:App/items:n:1--><li>one</li>' +
        '<!--mmd:w:App/items:n:2--><li>two</li>' +
        '<!--/mmd--></ul>' +
        '</section><!--/mmd-->',
    );
    const index = new HydrationMarkerIndex(
      claimHydrationRoot(host, 'App'),
    );

    expect(index.size).toBe(4);
    const branch = index.claimRange('g', 'App/when0');
    const branchPlan = new HydrationNodePlan(branch);
    branchPlan.claimNode({ nodeType: 3 });
    const paragraph = branchPlan.claimNode({
      nodeType: 1,
      tagName: 'p',
    });
    expect((paragraph as Element).textContent).toBe('branch');
    branchPlan.expectDone();

    const list = index.claimRange('l', 'App/items');
    expect(list.open.data).toBe('mmd:l:App/items');
    const first = index.claimRow('App/items', 'n:1');
    const second = index.claimRow('App/items', 'n:2');
    for (const [range, label] of [[first, 'one'], [second, 'two']] as const) {
      const plan = new HydrationNodePlan(range);
      plan.claimNode({ nodeType: 3 });
      expect(plan.claimNode({ nodeType: 1, tagName: 'li' }).textContent).toBe(label);
      plan.expectDone();
    }
    expect(index.unclaimed).toBe(0);
  });

  it('rejects missing, mistyped, duplicate, and repeated marker claims', () => {
    const host = hostWith(
      '<!--mmd:r:App-->' +
        '<!--mmd:g:App/when0--><!--/mmd-->' +
        '<!--mmd:l:App/items--><!--/mmd-->' +
        '<!--/mmd-->',
    );
    const index = new HydrationMarkerIndex(
      claimHydrationRoot(host, 'App'),
    );

    index.claimRange('g', 'App/when0');
    expect(() => index.claimRange('g', 'App/when0')).toThrow(
      'the range was already claimed',
    );
    expect(() => index.claimRange('g', 'App/items')).toThrow(
      'expected <!--mmd:g:App/items-->, found <!--mmd:l:App/items-->',
    );
    expect(() => index.claimRow('App/items', 'n:404')).toThrow(
      'no matching marker in the server stream',
    );

    const duplicate = hostWith(
      '<!--mmd:r:App-->' +
        '<!--mmd:g:App/when0--><!--/mmd-->' +
        '<!--mmd:g:App/when0--><!--/mmd-->' +
        '<!--/mmd-->',
    );
    expect(
      () =>
        new HydrationMarkerIndex(
          claimHydrationRoot(duplicate, 'App'),
        ),
    ).toThrow('a duplicate identity in the server stream');
  });

  it('keeps namespace failures bounded without changing server nodes', () => {
    const host = hostWith('<!--mmd:r:App--><svg><circle></circle></svg><!--/mmd-->');
    const original = host.innerHTML;
    const circle = host.querySelector('circle')!;
    const svg = host.querySelector('svg')!;
    const plan = new HydrationNodePlan(claimHydrationRoot(host, 'App'));
    expect(() => plan.claimNode({ nodeType: 1, tagName: 'circle', namespaceURI: 'http://www.w3.org/1999/xhtml' }))
      .toThrow(HydrationMismatchError);
    expect(plan.remaining).toBe(2);
    expect(plan.claimNode({ nodeType: 1, tagName: 'circle', namespaceURI: 'http://www.w3.org/2000/svg' })).toBe(circle);
    expect(plan.claimNode({ nodeType: 1, tagName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg' })).toBe(svg);
    plan.expectDone();
    expect(host.innerHTML).toBe(original);
  });

  it('reports bounded marker, tag, and close mismatches', () => {
    const wrongTag = hostWith(
      '<!--mmd:r:App--><section></section><!--/mmd-->',
    );
    const plan = new HydrationNodePlan(claimHydrationRoot(wrongTag, 'App'));
    expect(() =>
      plan.claimNode({ nodeType: 1, tagName: 'main' }),
    ).toThrowError(HydrationMismatchError);
    expect(() =>
      plan.claimNode({ nodeType: 1, tagName: 'main' }),
    ).toThrow("expected element <main>, found element <section>");

    const missingRoot = hostWith('<!--mmd:r:Other--><!--/mmd-->');
    expect(() => claimHydrationRoot(missingRoot, 'App')).toThrow(
      'no matching application-root marker',
    );

    const missingClose = hostWith('<!--mmd:r:App--><main></main>');
    expect(() => claimHydrationRoot(missingClose, 'App')).toThrow(
      'a matching <!--/mmd--> close',
    );
  });
});
