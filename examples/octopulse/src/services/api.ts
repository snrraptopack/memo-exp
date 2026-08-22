/**
 * Real-World API Services & Interfaces
 * 
 * Demonstrates:
 * 1. Exporting typed interfaces for GitHub and DummyJSON responses
 * 2. Helper factory functions creating isolated `createDataRuntime` instances
 */

import { createDataRuntime, type DataRuntime } from '@memoized-dom/data';

// ==========================================
// 1. GitHub REST API Service Types
// ==========================================

export interface GithubRepoItem {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  updated_at: string;
  topics?: string[];
}

export interface GithubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GithubRepoItem[];
}

export interface GithubIssueItem {
  id: number;
  number: number;
  title: string;
  user: {
    login: string;
    avatar_url: string;
  };
  state: 'open' | 'closed';
  comments: number;
  created_at: string;
  html_url: string;
  body: string | null;
  labels: Array<{
    id: number;
    name: string;
    color: string;
  }>;
}

/**
 * Creates an isolated DataRuntime instance for GitHub REST API
 */
export function createGithubApi(): DataRuntime {
  return createDataRuntime({
    baseURL: 'https://api.github.com/',
  });
}

// ==========================================
// 2. DummyJSON Live REST API Service (Tasks)
// ==========================================

export interface LiveTask {
  id: number;
  todo: string;
  completed: boolean;
  userId: number;
}

export interface LiveTasksResponse {
  todos: LiveTask[];
  total: number;
  skip: number;
  limit: number;
}

/**
 * Creates an isolated DataRuntime instance for Live Tasks API
 */
export function createTaskApi(): DataRuntime {
  return createDataRuntime({
    baseURL: 'https://dummyjson.com/',
  });
}
