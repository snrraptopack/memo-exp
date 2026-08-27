const GLOBAL_CONTROLLER_KEY = '__MMD_DATA_CONTROLLERS__';

export function getGlobalControllers(): WeakMap<object, unknown> {
  const g = globalThis as unknown as Record<string, unknown>;
  return (g[GLOBAL_CONTROLLER_KEY] ??= new WeakMap<object, unknown>()) as WeakMap<object, unknown>;
}
