import { $routed } from '../src';
import { createRouteRuntime } from '../src/internal';

const runtime = createRouteRuntime();

runtime.navigate('/docs');
runtime.navigate('/docs', { query: { tab: 'compiler' } });
runtime.navigate('/users/:userId', { params: { userId: 'ada' } });
runtime.navigate('/organizations/:organizationId/projects/:projectId', {
  params: {
    organizationId: 'acme',
    projectId: 42,
  },
});
runtime.navigate('/docs/*', { params: { '*': 'compiler/setup' } });

// @ts-expect-error Route query state is deliberately read-only.
runtime.route.query.set('tab', 'compiler');

// @ts-expect-error A dynamic route requires its parameters.
runtime.navigate('/users/:userId');

runtime.navigate('/users/:userId', {
  // @ts-expect-error The parameter name comes from the path literal.
  params: { id: 'ada' },
});

// @ts-expect-error A wildcard destination requires its splat value.
runtime.navigate('/docs/*');

runtime.dispose();

const prepared = $routed(({ state, params, url, query, request, signal }) => {
  void params.reportId;
  void url.pathname;
  void query.get('tab');
  void request.method;
  void signal.aborted;

  // @ts-expect-error Cache state is not a second route context.
  void state.params;

  return Promise.resolve({ title: 'Prepared report' });
});

void prepared.title;
