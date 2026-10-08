import { expect, it } from 'vitest';
import { parseHydrationMarker, parseRootHydrationIdentity } from '../packages/runtime/src/hydration-marker';

it('recognizes root identities while preserving attribute and malformed-marker rules', () => {
  expect(parseRootHydrationIdentity('mmd:r:App')).toBe('App');
  expect(parseRootHydrationIdentity('mmd:r:App @ src/App.tsx:4:2')).toBe('App');
  expect(parseRootHydrationIdentity('mmd:r:App @ >')).toBe('App');
  for (const comment of ['/mmd', 'mmd:c:App', 'mmd:r:', 'mmd:r: @ file', 'mmd:r:App>', 'ordinary']) {
    expect(parseRootHydrationIdentity(comment)).toBeNull();
  }
});

it('matches full-protocol root recognition across valid and malformed comments', () => {
  const kinds = ['r','c','g','l','w','d','q','','rr','R'];
  const payloads = ['', 'App', 'App/items:n:1', 'a>b', 'App @ file:1:2', 'App @ ',
    'App @ >', ' @ file', 'mmd:r:Nested', '🌍', 'App @ file @ next', ' App', 'a\nb'];
  for (const prefix of ['mmd:', 'other:']) for (const kind of kinds) for (const payload of payloads) {
    const comment = `${prefix}${kind}:${payload}`;
    const full = parseHydrationMarker(comment);
    expect(parseRootHydrationIdentity(comment), comment).toBe(full?.type === 'open' && full.kind === 'r' ? full.identity : null);
  }
});
