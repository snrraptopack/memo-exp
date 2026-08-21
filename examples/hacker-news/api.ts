import {
  createDataRuntime,
  type DataRuntime,
  type FetchResource,
  type Query,
} from '@memoized-dom/data';
import type {
  FeedKind,
  HackerNewsFeedResponse,
  HackerNewsStory,
} from './types';

export const HACKER_NEWS_API = 'https://hn.algolia.com/';
export const FEED_PAGE_SIZE = 25;

export function createHackerNewsData(fetcher?: typeof fetch): DataRuntime {
  return createDataRuntime({
    baseURL: HACKER_NEWS_API,
    ...(fetcher === undefined ? {} : { fetch: fetcher }),
  });
}

function feedDescriptor(kind: FeedKind): {
  readonly target: string;
  readonly tags: string;
} {
  switch (kind) {
    case 'top':
      return { target: '/api/v1/search', tags: 'front_page' };
    case 'newest':
      return { target: '/api/v1/search_by_date', tags: 'story' };
    case 'ask':
      return { target: '/api/v1/search_by_date', tags: 'ask_hn' };
    case 'show':
      return { target: '/api/v1/search_by_date', tags: 'show_hn' };
    case 'jobs':
      return { target: '/api/v1/search_by_date', tags: 'job' };
  }
}

export function loadFeedPage(
  data: DataRuntime,
  kind: FeedKind,
  page: number,
): FetchResource<HackerNewsFeedResponse> {
  const descriptor = feedDescriptor(kind);
  const query: Query = {
    tags: descriptor.tags,
    page,
    hitsPerPage: FEED_PAGE_SIZE,
  };
  return data.$fetch<HackerNewsFeedResponse>(descriptor.target, {
    query,
    key: ['hacker-news', kind, page],
    cache: { scope: 'app' },
  });
}

export function loadStory(
  data: DataRuntime,
  storyId: string,
): FetchResource<HackerNewsStory> {
  return data.$fetch<HackerNewsStory>(`/api/v1/items/${encodeURIComponent(storyId)}`, {
    key: ['hacker-news-story', storyId],
    cache: { scope: 'app' },
  });
}

export function storyDomain(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function timeAgo(unixSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (elapsed < 60) return 'just now';
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function commentText(markup: string | null): string {
  if (!markup) return '[comment removed]';
  const withoutTags = markup
    .replace(/<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  if (typeof document === 'undefined') return withoutTags;
  const decoder = document.createElement('textarea');
  decoder.innerHTML = withoutTags;
  return decoder.value;
}
