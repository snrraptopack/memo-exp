import type { ApplicationServices } from './services';

/** Application-wide server contract registered with @memoized-dom/server. */
export interface ServerTypes {
  locals: {
    requestId: string;
    user?: string;
  };
  services: ApplicationServices;
}
