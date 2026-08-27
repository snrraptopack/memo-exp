import type { WebHandler } from './index';

export type BunFetch = (request: Request) => Response | Promise<Response>;

/**
 * Bun.serve already speaks Web Request/Response; this adapter preserves the
 * common handler contract while normalizing synchronous handlers to promises.
 */
export function createBunFetch(handler: WebHandler): BunFetch {
  return (request) => handler(request);
}
