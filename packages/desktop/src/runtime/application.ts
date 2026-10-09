import type { DesktopHost, SceneHandle, SceneTemplate } from '../bridge/protocol';
import { createOwnerForest } from './ownership';
import { createPublicationQueue } from './publication';
import type { SceneComponent } from './definitions';

export interface TextBinding { readonly slot: number; readonly sources: readonly string[] | null; readonly read: () => unknown }
export interface SceneHandler { readonly callback: (event: unknown) => unknown; readonly sources: readonly string[] | null }
export interface SceneChildBinding {
  readonly node: number;
  readonly sources: readonly string[] | null;
  readonly component: (props: Readonly<Record<string, unknown>>) => SceneInstance;
  readonly read: () => Readonly<Record<string, unknown>>;
}
export interface SceneMountOptions {
  readonly children?: readonly SceneChildBinding[];
  readonly receiveProps?: (props: Readonly<Record<string, unknown>>) => void;
  readonly components?: readonly SceneComponent[];
  readonly regions?: readonly SceneRegionBinding[];
  readonly lists?: readonly SceneListBinding[];
}
export type SceneRowKey = string | number;
export interface SceneListBinding {
  readonly node: number;
  readonly sources: readonly string[] | null;
  readonly component: SceneComponent;
  readonly read: () => readonly { readonly key: SceneRowKey; readonly props: Readonly<Record<string, unknown>> }[];
}
export interface SceneRegionBinding {
  readonly node: number;
  readonly sources: readonly string[] | null;
  readonly branches: readonly (SceneComponent | null)[];
  readonly read: () => { readonly branch: number; readonly props: Readonly<Record<string, unknown>> };
}
export interface SceneInstance {
  readonly handle: SceneHandle;
  readonly ready: Promise<void>;
  readonly mounted: boolean;
  flush(): Promise<void>;
  dispatch(event: number, payload?: unknown): Promise<unknown>;
  dispose(): Promise<void>;
}
export interface DesktopApplication {
  mount<T>(factory: () => T): T;
  dispatch(handle: SceneHandle, event: number, payload?: unknown): Promise<unknown>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
interface ApplicationContext {
  mount(template: SceneTemplate, bindings: readonly TextBinding[], handlers: readonly SceneHandler[], options?: SceneMountOptions): SceneInstance;
}
let active: ApplicationContext | undefined;

export function sceneEvent(callback: SceneHandler['callback'], sources: readonly string[] | null): SceneHandler { return { callback, sources }; }
export function mountScene(template: SceneTemplate, bindings: readonly TextBinding[], handlers: readonly SceneHandler[], options?: SceneMountOptions): SceneInstance {
  if (!active) throw new Error('Mount a desktop component inside application.mount()');
  return active.mount(template, bindings, handlers, options);
}

/** Ownership, expression preparation and publication stay separate from entry evaluation. */
export function createDesktopApplication(host: DesktopHost): DesktopApplication {
  let closed = false;
  const forest = createOwnerForest(createPublicationQueue(host), () => closed, factory => {
    const previous = active; active = context;
    try { return factory(); } finally { active = previous; }
  });
  const context: ApplicationContext = forest;
  return {
    mount(factory) {
      if (closed) throw new Error('Desktop application is disposed');
      const previous = active;
      const before = new Set(forest.owners.keys());
      active = context;
      try {
        const result = factory();
        if (result instanceof Promise) throw new Error('Desktop mount factories must be synchronous');
        return result;
      } catch (error) {
        for (const instance of forest.owners.keys()) if (!before.has(instance)) void instance.dispose().catch(() => {});
        throw error;
      } finally { active = previous; }
    },
    async dispatch(handle, event, payload) {
      if (closed) throw new Error('Desktop application is disposed');
      const instance = forest.find(handle);
      if (instance) return instance.dispatch(event, payload);
      throw new Error('Native desktop event targets an unknown or retired owner');
    },
    async flush() {
      const results = await Promise.allSettled(forest.roots().map(instance => instance.flush()));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Desktop scene publication failed');
    },
    async dispose() {
      closed = true;
      const results = await Promise.allSettled(forest.roots().map(instance => instance.dispose()));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Desktop scene disposal failed');
    },
  };
}
