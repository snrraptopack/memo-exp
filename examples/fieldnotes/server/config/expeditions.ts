import type { Store } from './store';
import { delay } from '../latency';

export function createExpeditionService(store: Store) {
  return {
    all: () => store.expeditions,
    find: async (id: string) => {
      await delay(1200);
      return store.expeditions.find(e => e.id === id) ?? null;
    },
  };
}

export type ExpeditionService = ReturnType<typeof createExpeditionService>;
