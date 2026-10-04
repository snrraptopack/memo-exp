/** Build identity shared by the page host and server renderer. */
export interface InitialBootstrap {
  readonly key: string;
  readonly target: string;
  readonly browser: 'none' | 'bindings';
}

const DESCRIPTOR = /<!--mmd:initial-delivery:([^]*?)-->/g;

export function initialBootstrapDescriptor(value: InitialBootstrap): string {
  return `<!--mmd:initial-delivery:${encodeURIComponent(JSON.stringify(value))}-->`;
}

export function readInitialBootstrap(html: string): { descriptor: InitialBootstrap; html: string } | undefined {
  const matches = [...html.matchAll(DESCRIPTOR)];
  if (!matches.length) return undefined;
  const invalid = (): never => { throw new TypeError('memo-dom: invalid compiler delivery descriptor in page template'); };
  if (matches.length !== 1) return invalid();
  let value: InitialBootstrap;
  try { value = JSON.parse(decodeURIComponent(matches[0]![1]!)); } catch { return invalid(); }
  if (value === null || typeof value !== 'object' || typeof value.key !== 'string' || !/^[a-f0-9]{64}$/.test(value.key) ||
      typeof value.target !== 'string' || !value.target || value.browser !== 'none' && value.browser !== 'bindings') return invalid();
  return { descriptor: value, html: html.replace(DESCRIPTOR, '') };
}
