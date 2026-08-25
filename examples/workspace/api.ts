import { createDataRuntime, setActiveDataRuntime } from "@memoized-dom/data";
/**
 * Mock workspace API — realistic shape: one injected client, JSON endpoints,
 * artificial latency so pending/error arms are actually visible.
 */
import type { Notification, User } from './session';


const LATENCY = 600;

function respond(payload: unknown, delay = LATENCY): Promise<Response> {
  return new Promise((accept) => {
    setTimeout(
      () =>
        accept(
          new Response(JSON.stringify(payload), {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      delay,
    );
  });
}

const user: User = { id: 1, name: 'Ada Lovelace', email: 'ada@workspace.dev' };

let notifications: Notification[] = [
  { id: 'n1', text: 'Deploy finished for workspace-api', read: false },
  { id: 'n2', text: 'Mira commented on your review', read: false },
  { id: 'n3', text: 'Weekly digest is ready', read: true },
];

export function installWorkspaceApi(): void {
  // Realistic: apps inject their API client; module sources bind to it
  // lazily, per runtime. No eager requests at import time.
  const api = createDataRuntime({
    fetch: mockFetch as unknown as typeof fetch & { preconnect?: () => void },
  });
  setActiveDataRuntime(api);
}

function mockFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/api/session')) return respond(user, 400);
  if (url.includes('/api/notifications')) return respond(notifications, 900);
  if (url.includes('/api/read')) {
    notifications = notifications.map((n) => ({ ...n, read: true }));
    return respond({ ok: true }, 120);
  }
  return respond({ error: 'not found' }, 50);
}
