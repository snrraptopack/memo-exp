import { describe, expect, it, vi } from 'vitest';
import {
  createHackerNewsData,
  loadFeedPage,
  loadStory,
} from '../examples/hacker-news/api';

describe('Hacker News router and data example', () => {
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
    }) as unknown as typeof fetch;
    const data = createHackerNewsData(fetcher);

    const feed = loadFeedPage(data, 'ask', 2);
    await vi.waitFor(() => expect(feed.status).toBe('success'));

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
    }) as unknown as typeof fetch;
    const data = createHackerNewsData(fetcher);

    const story = loadStory(data, '123');
    await vi.waitFor(() => expect(story.status).toBe('success'));

    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe('/api/v1/items/123');
    expect(story.data?.title).toBe('A typed story route');

    data.clear();
  });
});
