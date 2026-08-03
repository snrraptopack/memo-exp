import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  buildRoutePath,
  createRouteQuery,
  joinRoutePaths,
  matchRoutePattern,
  rankRoutePattern,
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
  });

  it('infers parameter names from literal paths', () => {
    type Params = RouteParams<
      '/organizations/:organizationId/projects/:projectId'
    >;
    expectTypeOf<Params>().toEqualTypeOf<{
      organizationId: string | number | boolean | bigint;
      projectId: string | number | boolean | bigint;
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
  });

  it('fails before navigation when a runtime pattern is missing a parameter', () => {
    expect(() => buildRoutePath(
      '/users/:userId',
      {} as RouteParams<'/users/:userId'>,
    )).toThrow("Missing route parameter 'userId'");
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
});
