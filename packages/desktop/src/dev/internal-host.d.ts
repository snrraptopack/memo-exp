declare module '@memoized-dom/desktop/internal-host' {
  export function connectNativeHost(
    options: import('../host/transport').NativeProcessOptions,
  ): import('../host/transport').PublicationTransport;
}
