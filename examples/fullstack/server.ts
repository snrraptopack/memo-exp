/** Fullstack server composition using the public serve() application API. */
import {
  serve,
  type ServerMiddleware,
} from '@memoized-dom/server';
import { App } from './App';
import { createServices } from '#server/config/services';

let sequence = 0;

const logger: ServerMiddleware = async (context, next) => {
  const response = await next();
  console.log(
    `[http] ${context.request.method} ${context.url.pathname} → ${response.status}`,
  );
  return response;
};

const session: ServerMiddleware = (context, next) => {
  context.locals.user = context.request.headers.get('x-user') ?? undefined;
  return next();
};

const requireAdmin: ServerMiddleware = (context, next) => {
  if (context.request.headers.get('x-admin') !== 'yes') {
    return new Response('Admins only', { status: 403 });
  }
  return next();
};

const app = serve({
  createLocals: () => ({ requestId: `req-${String(++sequence)}` }),
  createServices,
});

app.use(logger, session);
app.use('/api/admin/*', requireAdmin);

app.get('/api/health', context => ({
  ok: context.services.database.status() === 'ready',
  database: context.services.database.name,
}));
app.post('/api/echo', context => ({
  echoed: context.url.pathname,
  requestId: context.locals.requestId,
}));
app.get('/api/admin/stats', context => ({
  admin: context.locals.user ?? 'anonymous',
  requestId: context.locals.requestId,
}));

app.ssr(App);

export default app;
