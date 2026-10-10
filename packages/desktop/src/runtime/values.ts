export type SceneProps = Readonly<Record<string, unknown>>;
export type SceneCallback = (...args: unknown[]) => unknown;
export function affected(dependencies: readonly string[] | null, sources: Set<string> | null): boolean {
  return sources === null || dependencies === null || dependencies.some(source => sources.has(source));
}
export function sameProps(a: SceneProps, b: SceneProps): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
export function propValues(value: SceneProps, bindCallback?: (callback: SceneCallback) => SceneCallback): SceneProps {
  const props = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function' && bindCallback) props[key] = bindCallback(item as SceneCallback);
    else {
      if (item !== null && !['undefined', 'string', 'number', 'boolean', 'bigint'].includes(typeof item)) throw new TypeError('Desktop child props currently require primitive values or owned callbacks');
      props[key] = item;
    }
  }
  return props;
}
export function textValue(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (!['string', 'number', 'bigint'].includes(typeof value)) throw new TypeError('Desktop text expressions currently require a primitive value');
  return String(value);
}
