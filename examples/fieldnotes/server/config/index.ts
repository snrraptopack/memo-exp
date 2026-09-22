import type { ApplicationServices } from './services';

/** Application-wide server contract — types locals/services/platform
 *  everywhere serve() context is read. */
export interface ServerTypes {
  locals: {
    requestId: string;
    visitor: string;
  };
  services: ApplicationServices;
}
