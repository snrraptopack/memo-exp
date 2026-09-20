export interface ApplicationServices {
  readonly database: {
    readonly name: string;
    status(): 'ready';
  };
}

/**
 * Application-scoped runtime dependencies. A real app can connect its
 * database, queue, cache, or repositories here; serve() initializes this
 * factory lazily once for each application instance.
 */
export async function createServices(): Promise<ApplicationServices> {
  return {
    database: {
      name: 'fullstack-demo',
      status: () => 'ready',
    },
  };
}
