/** Server entry composed with the public serve() application API. */
import {
  serve,
  type ServerMiddleware,
} from '@memoized-dom/server';
import { App } from './App';

const SESSION = { name: 'Ada Lovelace', role: 'admin', avatar: 'A' };

const STORIES = [
  {
    id: 1,
    title: 'Memoized DOM ships streaming SSR with payload transport',
    category: 'Release',
    author: 'team',
    votes: 42,
    posted: '2h ago',
  },
  {
    id: 2,
    title: 'How colorless async modules eliminate data-fetching boilerplate',
    category: 'Guide',
    author: 'ada',
    votes: 31,
    posted: '5h ago',
  },
  {
    id: 3,
    title: 'Rolldown + OXC: instant cold starts for large graphs',
    category: 'Performance',
    author: 'team',
    votes: 27,
    posted: '1d ago',
  },
  {
    id: 4,
    title: 'Hydration without tears: the payload envelope explained',
    category: 'Deep dive',
    author: 'ada',
    votes: 19,
    posted: '2d ago',
  },
];

function devDelay(
  delays: Record<string, number>,
): ServerMiddleware {
  return async (context, next) => {
    const duration = delays[context.url.pathname];
    if (duration !== undefined) {
      await new Promise(resolve => setTimeout(resolve, duration));
    }
    return next();
  };
}

const pageCache: ServerMiddleware = async (_context, next) => {
  const response = await next();
  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set(
      'cache-control',
      'public, max-age=5, stale-while-revalidate=60',
    );
  }
  return response;
};

const app = serve();

app.use(pageCache);
app.use('/api/*', devDelay({
  '/api/session': 40,
  '/api/stories': 80,
}));
app.get('/api/session', () => SESSION);
app.get('/api/stories', () => STORIES);
app.ssr(App);

export default app;
