import { describe, expect, it } from 'vitest';
import {
  createRouteManifest,
  createRouteRuntime,
} from '../src';

describe('route manifest', () => {
  const manifest = createRouteManifest([
    {
      id: 'build',
      parentId: 'project',
      pattern: '/builds/:buildId',
      metadata: { title: 'Build' },
    },
    { id: 'root', pattern: '/' },
    { id: 'organization', parentId: 'root', pattern: '/organizations/:orgId' },
    { id: 'project', parentId: 'organization', pattern: '/projects/:projectId' },
    { id: 'organization-new', parentId: 'root', pattern: '/organizations/new' },
    { id: 'not-found', parentId: 'root', pattern: '/*' },
  ]);

  it('precomposes out-of-order nested definitions and builds by route ID', () => {
    expect(manifest.get('build')).toEqual(expect.objectContaining({
      pattern: '/builds/:buildId',
      fullPattern: '/organizations/:orgId/projects/:projectId/builds/:buildId',
      depth: 3,
    }));
    expect(manifest.build('build', {
      params: { orgId: 'acme', projectId: 'compiler', buildId: 42 },
      query: { tab: 'logs' },
      hash: 'latest',
    })).toBe(
      '/organizations/acme/projects/compiler/builds/42?tab=logs#latest',
    );
    expect(() => manifest.build('missing')).toThrow("Unknown route ID 'missing'");
  });

  it('resolves complete active chains with parameters owned by each route', () => {
    const matches = manifest.matchAll(
      '/organizations/acme/projects/compiler/builds/build-7',
    );

    expect(matches.map(match => match.id)).toEqual([
      'root',
      'organization',
      'project',
      'build',
    ]);
    expect(matches.map(match => match.params)).toEqual([
      {},
      { orgId: 'acme' },
      { projectId: 'compiler' },
      { buildId: 'build-7' },
    ]);
    expect(matches[3]?.metadata).toEqual({ title: 'Build' });
    expect(matches[2]?.pathname).toBe('/organizations/acme/projects/compiler');
  });

  it('keeps static precedence and terminal fallback routes', () => {
    expect(manifest.match('/organizations/new')?.id).toBe('organization-new');
    expect(manifest.match('/missing/deep/path')).toEqual(expect.objectContaining({
      id: 'not-found',
      params: { '*': 'missing/deep/path' },
    }));
  });

  it('lets the runtime publish a generated nested chain atomically', () => {
    const runtime = createRouteRuntime({
      environment: {},
      resolver: manifest.resolve.bind(manifest),
    });
    const received: string[] = [];
    runtime.subscribe(snapshot => {
      received.push(`${snapshot.pathname}:${snapshot.matches.length}`);
    });

    runtime.navigate('/organizations/:orgId/projects/:projectId/builds/:buildId', {
      params: { orgId: 'acme', projectId: 'compiler', buildId: '7' },
    });

    expect(runtime.route.params).toEqual({
      orgId: 'acme',
      projectId: 'compiler',
      buildId: '7',
    });
    expect(received).toEqual(['/:1', '/organizations/acme/projects/compiler/builds/7:4']);
    runtime.dispose();
  });

  it('rejects invalid parent graphs and ambiguous active parameters', () => {
    expect(() => createRouteManifest([
      { id: 'child', parentId: 'missing', pattern: '/child' },
    ])).toThrow("missing parent 'missing'");

    expect(() => createRouteManifest([
      { id: 'first', parentId: 'second', pattern: '/first' },
      { id: 'second', parentId: 'first', pattern: '/second' },
    ])).toThrow('parent cycle');

    expect(() => createRouteManifest([
      { id: 'parent', pattern: '/organizations/:id' },
      { id: 'child', parentId: 'parent', pattern: '/projects/:id' },
    ])).toThrow("shadows active parameter 'id'");

    expect(() => createRouteManifest([
      { id: 'one', pattern: '/users/:id' },
      { id: 'two', pattern: '/users/:name' },
    ])).toThrow('Ambiguous routes');
  });
});
