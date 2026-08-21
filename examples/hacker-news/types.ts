export type FeedKind = 'top' | 'newest' | 'ask' | 'show' | 'jobs';

export interface HackerNewsHit {
  readonly objectID: string;
  readonly title: string | null;
  readonly story_title?: string | null;
  readonly url: string | null;
  readonly story_url?: string | null;
  readonly author: string;
  readonly points: number | null;
  readonly num_comments: number | null;
  readonly created_at_i: number;
}

export interface HackerNewsFeedResponse {
  readonly hits: HackerNewsHit[];
  readonly page: number;
  readonly nbPages: number;
  readonly nbHits: number;
}

export interface HackerNewsComment {
  readonly id: number;
  readonly author: string | null;
  readonly text: string | null;
  readonly created_at_i: number;
  readonly children: HackerNewsComment[];
}

export interface HackerNewsStory {
  readonly id: number;
  readonly title: string;
  readonly url: string | null;
  readonly author: string;
  readonly points: number;
  readonly created_at_i: number;
  readonly children: HackerNewsComment[];
}
