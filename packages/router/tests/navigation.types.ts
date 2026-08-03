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

// @ts-expect-error A dynamic route requires its parameters.
runtime.navigate('/users/:userId');

runtime.navigate('/users/:userId', {
  // @ts-expect-error The parameter name comes from the path literal.
  params: { id: 'ada' },
});

runtime.dispose();
