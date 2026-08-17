import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  buildRoutePath,
  compareRoutePatterns,
  createRouteMatcher,
  createRouteQuery,
  joinRoutePaths,
  matchRoutePattern,
  parseRouteQuery,
  rankRoutePattern,
  validateRoutePattern,
  validateRoutePatterns,
} from '../src';
import type { RouteParams } from '../src';

describe('route paths', () => {
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
