import { serve } from '@memoized-dom/server';

const app = serve();

app.get('/health', () => ({ ok: true }));

app.get('/', () => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('<!doctype html>'));
      controller.enqueue(encoder.encode('<h1>Fullstack</h1>'));
      controller.close();
    },
  }), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

export default app;
