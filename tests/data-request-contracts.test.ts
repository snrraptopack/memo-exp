import { waitFor, type FetchStub } from '../test-support/helpers';
import { describe, expect, it, vi } from 'bun:test';
import { createDataRuntime } from '@memoized-dom/data';

describe('public data request contracts', () => {
  it('loads typed feed pages with the public data runtime', async () => {
    const requests: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      requests.push(url);
      return new Response(JSON.stringify({
        hits: [{ objectID: '42', title: 'Compiler-owned routing' }],
        page: 2,
        nbPages: 10,
        hitsPerPage: 25,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as FetchStub;
    const data = createDataRuntime({ baseURL: 'https://fixture.test/', fetch: fetcher });

    const feed = data.$fetch<{ hits: { title: string }[] }>('/api/v1/search_by_date', {
      query: { tags: 'ask_hn', page: 2, hitsPerPage: 25 },
      key: ['feed', 'ask', 2],
      cache: { scope: 'app' },
    });
    await waitFor(() => expect(feed.status).toBe('success'));

    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe('/api/v1/search_by_date');
    expect(requests[0].searchParams.get('tags')).toBe('ask_hn');
    expect(requests[0].searchParams.get('page')).toBe('2');
    expect(requests[0].searchParams.get('hitsPerPage')).toBe('25');
    expect(feed.data?.hits[0]?.title).toBe('Compiler-owned routing');

    data.clear();
  });

  it('loads a parameterized discussion through the same runtime', async () => {
    const requests: URL[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      requests.push(url);
      return new Response(JSON.stringify({
        id: 123,
        title: 'A typed story route',
        children: [],
      }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as FetchStub;
    const data = createDataRuntime({ baseURL: 'https://fixture.test/', fetch: fetcher });

    const story = data.$fetch<{ title: string }>('/api/v1/items/123', {
      key: ['story', '123'],
      cache: { scope: 'app' },
    });
    await waitFor(() => expect(story.status).toBe('success'));

    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe('/api/v1/items/123');
    expect(story.data?.title).toBe('A typed story route');

    data.clear();
  });
});
