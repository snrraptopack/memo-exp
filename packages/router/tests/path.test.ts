import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  buildRoutePath,
  compareRoutePatterns,
  createRouteMatcher,
  createRouteQuery,
  joinRoutePaths,
  matchRoutePattern,
  normalizeRoutePath,
  parseRouteQuery,
  rankRoutePattern,
  resolveRoutePath,
  validateRoutePattern,
  validateRoutePatterns,
} from '../src';
import type { RouteParams } from '../src';

describe('route paths', () => {
  it('shares templates safely between interpolation and exact/prefix matching', () => {
    const pattern = '/release.v1/:name/*';
    const url = buildRoutePath(pattern, { name: 'Ada Lovelace', '*': 'notes/intro' });
    expect(url).toBe('/release.v1/Ada%20Lovelace/notes/intro');
    expect(matchRoutePattern(pattern, url)?.params).toEqual({ name: 'Ada Lovelace', '*': 'notes/intro' });
    expect(matchRoutePattern(pattern, '/releaseXv1/Ada/notes')).toBeNull();
    expect(matchRoutePattern('/release.v1/:name', url, { end: false })).toMatchObject({
      params: { name: 'Ada Lovelace' }, remaining: '/notes/intro',
    });
    expect(matchRoutePattern('/release.v1/:name', url)).toBeNull();
    const exact = matchRoutePattern('/release.v1', '/release.v1');
    expect(matchRoutePattern('/release.v1', '/release.v1/child', { end: false })?.remaining).toBe('/child');
    expect(matchRoutePattern('/release.v1', '/release.v1')).toBe(exact);
    expect(buildRoutePath(pattern, { name: 'Grace', '*': 'other' })).toBe('/release.v1/Grace/other');
  });

  it('resolves route-relative destinations with directory semantics', () => {
    expect(resolveRoutePath('/projects/one', 'details')).toBe('/projects/one/details');
    expect(resolveRoutePath('/projects/one', '../two')).toBe('/projects/two');
    expect(resolveRoutePath('/projects/one?tab=old', '?tab=new')).toBe('/projects/one?tab=new');
    expect(resolveRoutePath('/projects/one?tab=old', '#activity')).toBe('/projects/one?tab=old#activity');
    expect(resolveRoutePath('/projects/one', '/settings')).toBe('/settings');
    expect(() => resolveRoutePath('/projects/one', '//example.com/stolen')).toThrow('same-origin');
  });

  it('composes nested route declarations without duplicating separators', () => {
    expect(joinRoutePaths(
      '/organizations/:organizationId/',
      '/projects/:projectId',
    )).toBe('/organizations/:organizationId/projects/:projectId');

    expect(joinRoutePaths('/docs', '/')).toBe('/docs');
    expect(joinRoutePaths('/', '/docs')).toBe('/docs');
    expect(() => joinRoutePaths('/docs/*', '/edit')).toThrow('must be terminal');
  });

  it('infers parameter names from literal paths', () => {
    type Params = RouteParams<
      '/organizations/:organizationId/projects/:projectId'
    >;
    expectTypeOf<Params>().toEqualTypeOf<{
      organizationId: string | number | boolean | bigint;
      projectId: string | number | boolean | bigint;
    }>();

    expectTypeOf<RouteParams<'/docs/*'>>().toEqualTypeOf<{
      '*': string | number | boolean | bigint;
    }>();
  });

  it('builds encoded destinations with stable repeated query values', () => {
    expect(buildRoutePath('/users/:userId', { userId: 'Ada Lovelace' }, {
      active: true,
      page: 2,
      tag: ['compiler', 'typed routes'],
      omitted: null,
    }, 'profile')).toBe(
      '/users/Ada%20Lovelace?active=true&page=2&tag=compiler&tag=typed+routes#profile',
    );

    expect(createRouteQuery({ z: 1, a: 2 })).toBe('?a=2&z=1');
    expect(parseRouteQuery('?a=2&z=1')).toEqual({ a: '2', z: '1' });
    expect(parseRouteQuery('?tag=compiler&tag=typed+routes')).toEqual({
      tag: ['compiler', 'typed routes'],
    });
    expect(parseRouteQuery('')).toEqual({});
  });

  it('does not return stale cached URLs for mutable public inputs', () => {
    const params = { userId: 'first' };
    const query = { page: 1, tags: ['one'] };

    expect(buildRoutePath('/users/:userId', params, query)).toBe(
      '/users/first?page=1&tags=one',
    );
    params.userId = 'second';
    query.page = 2;
    query.tags.push('two');
    expect(buildRoutePath('/users/:userId', params, query)).toBe(
      '/users/second?page=2&tags=one&tags=two',
    );
    expect(createRouteQuery(query)).toBe('?page=2&tags=one&tags=two');
  });

  it('returns immutable, prototype-safe parsed query dictionaries', () => {
    const parsed = parseRouteQuery('?__proto__=safe&tag=one&tag=two');

    expect(parsed['__proto__']).toBe('safe');
    expect(parsed.tag).toEqual(['one', 'two']);
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.tag)).toBe(true);
    expect(() => {
      (parsed as Record<string, unknown>).tag = 'changed';
    }).toThrow();
  });

  it('fails before navigation when a runtime pattern is missing a parameter', () => {
    expect(() => buildRoutePath(
      '/users/:userId',
      {} as RouteParams<'/users/:userId'>,
    )).toThrow("Missing route parameter 'userId'");
  });

  it('builds terminal wildcard destinations without losing path boundaries', () => {
    expect(buildRoutePath('/docs/*', { '*': 'compiler/setup guide' }))
      .toBe('/docs/compiler/setup%20guide');
    expect(() => buildRoutePath('/docs/*', { '*': '../private' }))
      .toThrow('contains an invalid path segment');
    expect(() => buildRoutePath('/users/:userId', { userId: '..' }))
      .toThrow('must not be a dot segment');
  });
});

describe('route matching', () => {
  it('matches exact static and parameter segments', () => {
    const match = matchRoutePattern(
      '/organizations/:organizationId/projects/:projectId',
      '/organizations/acme/projects/compiler/',
    );

    expect(match?.params).toEqual({
      organizationId: 'acme',
      projectId: 'compiler',
    });
    expect(match?.remaining).toBe('/');
  });

  it('decodes parameters and treats static punctuation literally', () => {
    expect(matchRoutePattern('/releases/v1.0/:name', '/releases/v1x0/core'))
      .toBeNull();
    expect(matchRoutePattern('/releases/v1.0/:name', '/releases/v1.0/Ada%20L'))
      .toMatchObject({ params: { name: 'Ada L' } });
  });

  it('supports prefix layout matches and reports the unconsumed path', () => {
    expect(matchRoutePattern('/docs/:section', '/docs/compiler/setup', {
      end: false,
    })).toMatchObject({
      params: { section: 'compiler' },
      consumed: '/docs/compiler',
      remaining: '/setup',
    });

    expect(matchRoutePattern('/docs', '/documentation', { end: false }))
      .toBeNull();
  });

  it('captures terminal wildcard content', () => {
    expect(matchRoutePattern('/docs/*', '/docs/missing/deep/path'))
      .toMatchObject({ params: { '*': 'missing/deep/path' } });
    expect(matchRoutePattern('/docs/*', '/docs'))
      .toMatchObject({ params: {} });
  });

  it('ranks static routes before parameters and parameters before wildcards', () => {
    expect(rankRoutePattern('/docs/compiler'))
      .toBeGreaterThan(rankRoutePattern('/docs/:section'));
    expect(rankRoutePattern('/docs/:section'))
      .toBeGreaterThan(rankRoutePattern('/docs/*'));
  });

  it('compares specificity at the first differing segment', () => {
    expect(compareRoutePatterns('/foo/:id', '/:type/bar')).toBeLessThan(0);
    expect([
      '/docs/*',
      '/:type/compiler',
      '/docs/:section',
      '/docs/compiler',
    ].sort(compareRoutePatterns)).toEqual([
      '/docs/compiler',
      '/docs/:section',
      '/docs/*',
      '/:type/compiler',
    ]);
  });

  it('rejects malformed patterns before matching or ranking', () => {
    expect(() => validateRoutePattern('/files/*/edit')).toThrow('must be terminal');
    expect(() => validateRoutePattern('/users/:bad-name')).toThrow(
      'Invalid route parameter',
    );
    expect(() => validateRoutePattern('/users/:id/posts/:id')).toThrow(
      "Duplicate route parameter 'id'",
    );
    expect(() => validateRoutePattern('/docs//compiler')).toThrow(
      'empty path segment',
    );
    expect(() => matchRoutePattern('/files/*/edit', '/files/a/edit'))
      .toThrow('must be terminal');
  });

  it('validates IDs and ambiguous equal-specificity route tables', () => {
    expect(() => validateRoutePatterns([
      { id: 'UserById', pattern: '/users/:id' },
      { id: 'UserByName', pattern: '/users/:name' },
    ])).toThrow('Ambiguous routes');
    expect(() => validateRoutePatterns([
      { id: 'Docs', pattern: '/docs' },
      { id: 'Docs', pattern: '/documentation' },
    ])).toThrow("Duplicate route ID 'Docs'");
    expect(() => validateRoutePatterns([
      { id: 'StaticFirst', pattern: '/foo/:id' },
      { id: 'ParameterFirst', pattern: '/:type/bar' },
    ])).not.toThrow();
  });
});

describe('createRouteMatcher (Trie Route Table)', () => {
  const matcher = createRouteMatcher([
    { id: 'home', pattern: '/' },
    { id: 'services', pattern: '/services' },
    { id: 'service-new', pattern: '/services/new' },
    { id: 'service-detail', pattern: '/services/:serviceId' },
    { id: 'service-logs', pattern: '/services/:serviceId/logs' },
    { id: 'org-project', pattern: '/orgs/:orgId/projects/:projectId' },
    { id: 'docs-wildcard', pattern: '/docs/*' },
  ]);

  it('matches exact root and static routes', () => {
    expect(matcher.match('/')).toEqual({
      id: 'home',
      pattern: '/',
      pathname: '/',
      params: {},
    });

    expect(matcher.match('/services')).toEqual({
      id: 'services',
      pattern: '/services',
      pathname: '/services',
      params: {},
    });
  });

  it('prioritizes static segments over dynamic parameters on same branch', () => {
    expect(matcher.match('/services/new')).toEqual({
      id: 'service-new',
      pattern: '/services/new',
      pathname: '/services/new',
      params: {},
    });

    expect(matcher.match('/services/auth-vault')).toEqual({
      id: 'service-detail',
      pattern: '/services/:serviceId',
      pathname: '/services/auth-vault',
      params: { serviceId: 'auth-vault' },
    });
  });

  it('resolves multi-parameter nested routes and decodes values', () => {
    expect(matcher.match('/services/edge-gw/logs')).toEqual({
      id: 'service-logs',
      pattern: '/services/:serviceId/logs',
      pathname: '/services/edge-gw/logs',
      params: { serviceId: 'edge-gw' },
    });

    expect(matcher.match('/orgs/apex%20cloud/projects/core-api')).toEqual({
      id: 'org-project',
      pattern: '/orgs/:orgId/projects/:projectId',
      pathname: '/orgs/apex%20cloud/projects/core-api',
      params: { orgId: 'apex cloud', projectId: 'core-api' },
    });
  });

  it('resolves wildcard catch-alls', () => {
    expect(matcher.match('/docs/compiler/optimistic/state')).toEqual({
      id: 'docs-wildcard',
      pattern: '/docs/*',
      pathname: '/docs/compiler/optimistic/state',
      params: { '*': 'compiler/optimistic/state' },
    });

    expect(matcher.match('/docs')).toEqual({
      id: 'docs-wildcard',
      pattern: '/docs/*',
      pathname: '/docs',
      params: { '*': '' },
    });

    expect(createRouteMatcher([{ id: 'root-wildcard', pattern: '/*' }]).match('/'))
      .toEqual({
        id: 'root-wildcard',
        pattern: '/*',
        pathname: '/',
        params: { '*': '' },
      });
  });

  it('returns null for unmatched paths', () => {
    expect(matcher.match('/unregistered/route')).toBeNull();
  });

  it('implements RouteResolver resolve() method', () => {
    const matches = matcher.resolve({
      pathname: '/services/auth-vault',
    } as any);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('service-detail');

    const empty = matcher.resolve({
      pathname: '/non-existent',
    } as any);
    expect(empty).toHaveLength(0);
  });
});

describe('route matcher agreement', () => {
  const encodedCafe = new URL('http://localhost/caf\u00e9').pathname;

  it('collapses repeated slashes in pathnames', () => {
    expect(normalizeRoutePath('/a//b')).toBe('/a/b');
    expect(normalizeRoutePath('//a///b//')).toBe('/a/b');
    expect(matchRoutePattern('/a/b', '/a//b')?.pathname).toBe('/a/b');
    expect(createRouteMatcher(['/a/b']).match('/a//b')?.pathname).toBe('/a/b');
  });

  it('matches non-ASCII static segments against percent-encoded pathnames', () => {
    expect(encodedCafe).toBe('/caf%C3%A9');
    expect(matchRoutePattern('/caf\u00e9', encodedCafe)?.pattern).toBe('/caf\u00e9');
    expect(matchRoutePattern('/caf\u00e9', '/caf%c3%a9')?.pattern).toBe('/caf\u00e9');
    expect(matchRoutePattern('/caf\u00e9/:id', `${encodedCafe}/7`)?.params).toEqual({ id: '7' });
    expect(matchRoutePattern('/caf\u00e9', `${encodedCafe}/menu`, { end: false })).toMatchObject({
      consumed: encodedCafe,
      remaining: '/menu',
    });
    expect(createRouteMatcher(['/caf\u00e9']).match(encodedCafe)?.id).toBe('/caf\u00e9');
    expect(matchRoutePattern('/a%2Fb', '/a/b')).toBeNull();
    expect(createRouteMatcher(['/a%2Fb']).match('/a/b')).toBeNull();
  });

  it('reports an empty wildcard capture from both matchers', () => {
    expect(matchRoutePattern('/docs/*', '/docs')?.params).toEqual({ '*': '' });
    expect(matchRoutePattern('/*', '/')?.params).toEqual({ '*': '' });
    expect(createRouteMatcher(['/docs/*']).match('/docs')?.params).toEqual({ '*': '' });
  });

  it('returns immutable cached matches', () => {
    const prefix = matchRoutePattern('/settings', '/settings/profile', { end: false })!;
    expect(Object.isFrozen(prefix)).toBe(true);
    expect(Object.isFrozen(matchRoutePattern('/users/:id', '/users/1'))).toBe(true);
    expect(matchRoutePattern('/settings', '/settings/profile', { end: false })).toBe(prefix);
  });

  it('rejects queries and hashes embedded in a destination pattern', () => {
    expect(() => buildRoutePath('/search?q=router')).toThrow('use the query and hash options');
    expect(() => buildRoutePath('/docs#intro')).toThrow('use the query and hash options');
    expect(buildRoutePath('/search', undefined, { q: 'router' }, 'top')).toBe('/search?q=router#top');
  });
});
