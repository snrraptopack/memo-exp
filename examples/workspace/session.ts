/**
 * Workspace data layer — RFC colorless module sources.
 *
 * Module-scope sources are lazy descriptions: nothing runs at import time.
 * The active DataRuntime (installed in main.ts) materializes them on first
 * read, per runtime — request-local on the server.
 */
import { $fetch } from '@memoized-dom/data';

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Notification {
  id: string;
  text: string;
  read: boolean;
}

/** Session source — consumed by any component via plain value reads. */
export const currentUser = $fetch<User>('/api/session');

/** Notifications source — a list; Group supplies its pending/error arms. */
export const notifications = $fetch<Notification[]>('/api/notifications');
