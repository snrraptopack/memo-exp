/**
 * Data layer — RFC colorless module sources.
 *
 * Sources are lazy descriptions: nothing runs at import time. The active
 * DataRuntime materializes them on first read — request-local on the server,
 * payload-restored (no refetch) on the client.
 */
import { $fetch } from '@memoized-dom/data';

export interface SessionUser {
  name: string;
  role: string;
  avatar: string;
}

export interface Story {
  id: number;
  title: string;
  category: string;
  author: string;
  votes: number;
  posted: string;
}

/** Session source — consumed anywhere via plain value reads. */
export const currentUser = $fetch<SessionUser>('/api/session');

/** Stories source — a list; Group supplies its pending/error arms. */
export const stories = $fetch<Story[]>('/api/stories');

