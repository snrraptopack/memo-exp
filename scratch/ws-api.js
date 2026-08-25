import * as _MD from "@memoized-dom/runtime";
import { createDataRuntime, setActiveDataRuntime } from "@memoized-dom/data";
/**
 * Mock workspace API — realistic shape: one injected client, JSON endpoints,
 * artificial latency so pending/error arms are actually visible.
 */

const LATENCY = 600;
function respond(payload, delay = LATENCY) {
  return new Promise(accept => {
    setTimeout(() => accept(new Response(JSON.stringify(payload), {
      headers: {
        'content-type': 'application/json'
      }
    })), delay);
  });
}
const user = {
  id: 1,
  name: 'Ada Lovelace',
  email: 'ada@workspace.dev'
};
let notifications = [{
  id: 'n1',
  text: 'Deploy finished for workspace-api',
  read: false
}, {
  id: 'n2',
  text: 'Mira commented on your review',
  read: false
}, {
  id: 'n3',
  text: 'Weekly digest is ready',
  read: true
}];
export function installWorkspaceApi() {
  // Realistic: apps inject their API client; module sources bind to it
  // lazily, per runtime. No eager requests at import time.
  const api = createDataRuntime({
    fetch: mockFetch
  });
  setActiveDataRuntime(api);
}
function mockFetch(input) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/api/session')) return respond(user, 400);
  if (url.includes('/api/notifications')) return respond(notifications, 900);
  if (url.includes('/api/read')) {
    notifications = notifications.map(n => ({
      ...n,
      read: true
    }));
    return respond({
      ok: true
    }, 120);
  }
  return respond({
    error: 'not found'
  }, 50);
}