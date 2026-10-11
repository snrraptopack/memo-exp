import { isSceneScope, sameSceneScope } from './scope';
import { isSceneContent, type SceneContent } from './content';

export type SceneProps = Readonly<Record<string, unknown>>;
export type SceneCallback = (...args: unknown[]) => unknown;
export function affected(
  dependencies: readonly string[] | null,
  sources: ReadonlySet<string> | null,
): boolean {
  return (
    sources === null || dependencies === null || dependencies.some((source) => sources.has(source))
  );
}
export function sameProps(a: SceneProps, b: SceneProps): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) && (Object.is(a[key], b[key]) || sameSceneScope(a[key], b[key])),
    )
  );
}
export function propValues(
  value: SceneProps,
  bindCallback?: (callback: SceneCallback) => SceneCallback,
  bindContent?: (content: SceneContent) => SceneContent,
): SceneProps {
  const props = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    if (isSceneContent(item)) props[key] = bindContent ? bindContent(item) : item;
    else if (isSceneScope(item)) props[key] = item;
    else if (typeof item === 'function' && bindCallback)
      props[key] = bindCallback(item as SceneCallback);
    else {
      if (typeof item === 'function')
        throw new TypeError('Desktop callback props require an owning component');
      if (typeof item === 'symbol') throw new TypeError('Desktop child props cannot be symbols');
      props[key] = item;
    }
  }
  return props;
}

/** Reference equality cannot prove that ordinary data was not edited in place. */
export function needsPropRefresh(previous: SceneProps, next: SceneProps): boolean {
  return (
    !sameProps(previous, next) ||
    Object.values(next).some(
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        !isSceneScope(value) &&
        !isSceneContent(value),
    )
  );
}
export function textValue(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (!['string', 'number', 'bigint'].includes(typeof value))
    throw new TypeError('Desktop text expressions currently require a primitive value');
  return String(value);
}
