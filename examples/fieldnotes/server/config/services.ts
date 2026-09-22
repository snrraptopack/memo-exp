import { createStore } from './store';
import {
  createExpeditionService,
  type ExpeditionService,
} from './expeditions';
import { createNoteService, type NoteService } from './notes';

export interface ApplicationServices {
  readonly expeditions: ExpeditionService;
  readonly notes: NoteService;
}

/** Compose the service graph — each service is a small factory taking the
 *  dependencies it needs. Add services here as the app grows. */
export async function createServices(): Promise<ApplicationServices> {
  const store = createStore();
  return {
    expeditions: createExpeditionService(store),
    notes: createNoteService(store),
  };
}
