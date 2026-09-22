import { serve } from '@memoized-dom/server';
import { Main } from './App';
import { createServices } from '#server/config/services';
import { createLocals } from '#server/config/locals';
import { logger, session } from '#server/middleware';
import { delay } from '#server/latency';

const app = serve({ createLocals, createServices });

app.use(logger, session);

app.get('/api/health', async (context) => {
  await delay(500);
  return {
    ok: true,
    expeditions: context.services.expeditions.all().length,
  };
});

app.ssr(Main);

export default app;
