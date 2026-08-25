import { describe, expect, it } from 'vitest';
import {
  createHydrationCursor,
  HydrationMismatchError,
  parseHydrationMarker,
} from '@memoized-dom/runtime';

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
