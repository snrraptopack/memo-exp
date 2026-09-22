import type { ServerMiddleware } from '@memoized-dom/server';

export const logger: ServerMiddleware = async (context, next) => {
  const started = Date.now();
  const response = await next();
  console.log(
    `[http] ${context.request.method} ${context.url.pathname} → ${response.status} (${Date.now() - started}ms)`,
  );
  return response;
};

export const session: ServerMiddleware = (context, next) => {
  context.locals.visitor =
    context.request.headers.get('x-visitor') ?? 'anonymous';
  return next();
};
