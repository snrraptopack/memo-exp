export function fetch(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    return Response.json({ ok: true });
  }

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
}
