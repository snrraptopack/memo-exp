/** Target implementation of the framework's normal mount(target, component) API. */
import type { DesktopApplication, SceneInstance } from './application';

export interface DesktopRoot extends SceneInstance {
  readonly rootId: string;
  readonly mounted: boolean;
  unmount(): Promise<void>;
}
interface RootScope { app: DesktopApplication; roots: Map<string, DesktopRoot> }
let scope: RootScope | undefined;

/** The desktop build redirects the authored runtime import to this target entry. */
export function mount(target: string, component: () => unknown): DesktopRoot {
  if (!scope) throw new Error('Desktop mount requires a desktop application entry');
  if (typeof target !== 'string' || !target) throw new Error('Desktop mount requires a named root');
  if (scope.roots.has(target)) throw new Error(`Desktop root '${target}' is already mounted`);
  const instance = scope.app.mount(component) as SceneInstance;
  if (!instance || !instance.handle || !(instance.ready instanceof Promise)) throw new Error('Desktop mount received an uncompiled component');
  const owner = scope;
  const root: DesktopRoot = {
    ...instance, rootId: target,
    get mounted() { return instance.mounted; },
    async unmount() {
      await instance.dispose();
      if (owner.roots.get(target) === root) owner.roots.delete(target);
    },
    dispose() { return root.unmount(); },
  };
  owner.roots.set(target, root);
  return root;
}

/** Own entry evaluation; refuse overlapping asynchronous imports in one realm. */
export async function runDesktopEntry(app: DesktopApplication, entry: () => Promise<unknown>): Promise<ReadonlyMap<string, DesktopRoot>> {
  if (scope) throw new Error('A desktop entry is already being evaluated');
  const current = { app, roots: new Map<string, DesktopRoot>() };
  scope = current;
  try {
    await entry();
    if (!current.roots.size) throw new Error('Desktop entry did not call mount(target, component)');
    await Promise.all([...current.roots.values()].map(root => root.ready));
    return current.roots;
  } catch (error) {
    try { await app.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Desktop entry and cleanup failed'); }
    throw error;
  } finally { scope = undefined; }
}
