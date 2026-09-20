import { describe, expect, it } from 'vitest';
import {
  createHydrationCursor,
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

describe('Phase 3 hydration cursor', () => {
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
    const root = createHydrationCursor(host, 'App');

    const adopted = root.cursor.claimNode({
      nodeType: 1,
      tagName: 'main',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
    });

    expect(adopted).toBe(original);
    root.cursor.expectDone();
    expect(host.querySelector('main')).toBe(original);
  });

  it('claims nested structural ranges and accepts empty regions', () => {
    const host = hostWith(
      '<!--mmd:r:App-->' +
        '<!--mmd:g:App/when0--><span>ready</span><!--/mmd-->' +
        '<!--mmd:g:App/when1--><!--/mmd-->' +
        '<!--/mmd-->',
    );
    const root = createHydrationCursor(host, 'App');
    const active = root.cursor.claimRange('g', 'App/when0');
    const span = active.cursor.claimNode({ nodeType: 1, tagName: 'span' });
    expect((span as Element).textContent).toBe('ready');
    active.cursor.expectDone();

    const empty = root.cursor.claimRange('g', 'App/when1');
    expect(empty.cursor.done).toBe(true);
    empty.cursor.expectDone();
    root.cursor.expectDone();
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
    const root = createHydrationCursor(host, 'App');
    const list = root.cursor.claimRange('l', 'App/items');

    const first = list.cursor.claimRow('App/items', 's:first');
    const alpha = first.cursor.claimNode({ nodeType: 1, tagName: 'li' });
    expect((alpha as Element).textContent).toBe('Alpha');
    const nested = first.cursor.claimRange('g', 'App/items/when0');
    const nestedSpan = nested.cursor.claimNode({
      nodeType: 1,
      tagName: 'span',
    });
    expect((nestedSpan as Element).textContent).toBe('nested');
    nested.cursor.expectDone();
    first.cursor.expectDone();

    const second = list.cursor.claimRow('App/items', 'n:42');
    const beta = second.cursor.claimNode({ nodeType: 1, tagName: 'li' });
    expect((beta as Element).textContent).toBe('Beta');
    second.cursor.expectDone();
    list.cursor.expectDone();
    root.cursor.expectDone();
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
    const plan = new HydrationNodePlan(createHydrationCursor(host, 'App'));

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
    const plan = new HydrationNodePlan(createHydrationCursor(host, 'App'));

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
      createHydrationCursor(host, 'App'),
    );

    expect(index.size).toBe(4);
    const branch = index.claimRange('g', 'App/when0');
    const paragraph = branch.cursor.claimNode({
      nodeType: 1,
      tagName: 'p',
    });
    expect((paragraph as Element).textContent).toBe('branch');
    branch.cursor.expectDone();

    const list = index.claimRange('l', 'App/items');
    expect(list.open.data).toBe('mmd:l:App/items');
    const first = index.claimRow('App/items', 'n:1');
    const second = index.claimRow('App/items', 'n:2');
    expect(
      (first.cursor.claimNode({ nodeType: 1, tagName: 'li' }) as Element)
        .textContent,
    ).toBe('one');
    expect(
      (second.cursor.claimNode({ nodeType: 1, tagName: 'li' }) as Element)
        .textContent,
    ).toBe('two');
  });

  it('rejects missing, mistyped, duplicate, and repeated marker claims', () => {
    const host = hostWith(
      '<!--mmd:r:App-->' +
        '<!--mmd:g:App/when0--><!--/mmd-->' +
        '<!--mmd:l:App/items--><!--/mmd-->' +
        '<!--/mmd-->',
    );
    const index = new HydrationMarkerIndex(
      createHydrationCursor(host, 'App'),
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
          createHydrationCursor(duplicate, 'App'),
        ),
    ).toThrow('a duplicate identity in the server stream');
  });

  it('reports bounded marker, tag, and close mismatches', () => {
    const wrongTag = hostWith(
      '<!--mmd:r:App--><section></section><!--/mmd-->',
    );
    const root = createHydrationCursor(wrongTag, 'App');
    expect(() =>
      root.cursor.claimNode({ nodeType: 1, tagName: 'main' }),
    ).toThrowError(HydrationMismatchError);
    expect(() =>
      root.cursor.claimNode({ nodeType: 1, tagName: 'main' }),
    ).toThrow("expected element <main>, found element <section>");

    const missingRoot = hostWith('<!--mmd:r:Other--><!--/mmd-->');
    expect(() => createHydrationCursor(missingRoot, 'App')).toThrow(
      'no matching application-root marker',
    );

    const missingClose = hostWith('<!--mmd:r:App--><main></main>');
    expect(() => createHydrationCursor(missingClose, 'App')).toThrow(
      'a matching <!--/mmd--> close',
    );
  });
});
