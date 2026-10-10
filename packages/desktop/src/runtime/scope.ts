/** Compiler captures stay in JavaScript; they are never serialized to the host. */
export interface SceneScope {
  readonly values: readonly unknown[];
}

const scopes = new WeakSet<object>();

/** Preserve row objects and callback bindings without widening authored props. */
export function sceneScope(...values: unknown[]): SceneScope {
  const scope = Object.freeze({ values: Object.freeze(values) });
  scopes.add(scope);
  return scope;
}

export function isSceneScope(value: unknown): value is SceneScope {
  return typeof value === 'object' && value !== null && scopes.has(value);
}

export function sameSceneScope(first: unknown, second: unknown): boolean {
  return isSceneScope(first) && isSceneScope(second)
    && first.values.length === second.values.length
    && first.values.every((value, index) => Object.is(value, second.values[index]));
}
