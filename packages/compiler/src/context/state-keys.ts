/** Resolve a binding-relative key using captured or live module identities. */
export function canonicalKeyFor(stateKeys: ReadonlyMap<string, string>, key: string): string {
  if (key.includes('#')) return key;
  const dot = key.indexOf('.');
  const root = dot === -1 ? key : key.slice(0, dot);
  const suffix = dot === -1 ? '' : key.slice(dot);
  return `${stateKeys.get(root) ?? root}${suffix}`;
}
