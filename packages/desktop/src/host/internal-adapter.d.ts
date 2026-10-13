declare module '@memoized-dom/desktop/internal-host' {
  export function connectNativeHost(
    options: import('./transport').NativeProcessOptions,
  ): import('./transport').PublicationTransport;
}
