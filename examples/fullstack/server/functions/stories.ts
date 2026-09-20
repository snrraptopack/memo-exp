/**
 * Server functions — named HTTP endpoints generated from this module.
 *
 * Every verb-prefixed async export becomes a real HTTP route mounted at
 * `/_fn/stories/<name>` by `serve()`, and a typed `$fetch` facade that
 * client code imports from `#server-functions`. This module's `middleware`
 * export composes in front of every endpoint it registers (RFC §11):
 * here it logs each server-function invocation.
 *
 * `getServerContext()` reads the active request context — the same locals
 * the `session` middleware in server.ts populated for this dispatch, whether
 * the request arrived over HTTP or through in-memory SSR dispatch.
 */
import { getServerContext } from '@memoized-dom/server';
import type { ServerMiddleware } from '@memoized-dom/server';


function logServerFunction(): ServerMiddleware {
  return (context, next) => {
    console.log(`[fn] ${context.request.method} ${context.url.pathname}`);
    return next();
  };
}

export const middleware = [
  logServerFunction(),
];

interface Story {
  id: number;
  title: string;
  summary: string;
  votes: number;
}

const stories: Story[] = [
  {
    id: 1,
    title: 'Middleware composes like any HTTP endpoint',
    summary: 'Module and directory middleware run in front of every generated server function.',
    votes: 3,
  },
  {
    id: 2,
    title: 'One data source for SSR and the browser',
    summary: 'The same route serves in-memory dispatch during SSR and real HTTP afterwards.',
    votes: 5,
  },
  {
    id: 3,
    title: 'Mutations are compiler-gated',
    summary: 'post* functions cannot run during render — only from event handlers.',
    votes: 2,
  },
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getStories() {
  return stories;
}

export async function getStory(id: number) {
  await delay(3000);
  return stories.find((story) => story.id === id) ?? null;
}

export async function postVote(id: number) {
  const { locals } = getServerContext();
  const story = stories.find((candidate) => candidate.id === id)!;

  story.votes += 1;
  await delay(3000);
  if(story.votes === 10 || story.votes === 15 || story.votes === 16 || story.votes === 18) {
    throw new Error('Story has reached the vote limit');
  }
  return { id: story.id, votes: story.votes, by: locals.user ?? 'anonymous' };
}

export async function deleteStory(id: number) {
  const { request } = getServerContext();
  if (request.headers.get('x-admin') !== 'yes') {
    throw new Error('deleteStory requires the x-admin: yes header');
  }
  const index = stories.findIndex((story) => story.id === id);
  if (index === -1) {
    throw new Error(`Unknown story ${String(id)}`);
  }

   await delay(3000);
  return stories.splice(index, 1)[0]!;
}
