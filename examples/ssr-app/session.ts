import { $fetch } from '@memoized-dom/data';

export interface UserSession {
  name: string;
  role: string;
  avatar: string;
  email: string;
}

export interface MetricItem {
  id: string;
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
}

export interface Story {
  id: number;
  title: string;
  category: string;
  author: string;
  votes: number;
  commentsCount: number;
  timestamp: string;
}

export interface SystemLog {
  id: string;
  level: 'info' | 'warn' | 'success';
  message: string;
  time: string;
}

// Module-level async data resources (RFC §16)
export const session = $fetch<UserSession>('/api/session');
export const metrics = $fetch<MetricItem[]>('/api/metrics');
export const feed = $fetch<Story[]>('/api/stories');
export const logs = $fetch<SystemLog[]>('/api/logs');
