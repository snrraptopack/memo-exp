import type { DesktopHost, NativeSceneEvent, SceneHandle, SceneTemplate } from '../bridge/protocol';
import { createOwnerForest } from './ownership';
import { createPublicationQueue } from './publication';
import type { SceneComponent } from './definitions';
import { createSceneSemanticRuntime } from './semantic';
import { componentModules } from './definitions';

export interface TextBinding {
  readonly slot: number;
  readonly sources: readonly string[] | null;
  readonly read: () => unknown;
}
export interface SceneHandler {
  readonly callback: (event: unknown) => unknown;
  readonly sources: readonly string[] | null;
}
export interface SceneChildBinding {
  readonly node: number;
  readonly sources: readonly string[] | null;
  readonly component: (props: Readonly<Record<string, unknown>>) => SceneInstance;
  readonly read: () => Readonly<Record<string, unknown>>;
}

export interface SceneMountOptions {
  /** Compiler lifecycle registrations execute after native acceptance. */
  readonly activate?: (owner: SceneInstance) => void;
  readonly cleanups?: readonly (() => void)[];
  readonly effects?: readonly SceneEffectBinding[];
  readonly refs?: readonly SceneRefBinding[];
  /** Replay compiler-planned setup calculations before reading destinations. */
  readonly prepare?: (sources: ReadonlySet<string> | null) => void;
  readonly modules?: readonly string[];
  /** Compiler fragments retain structure but share their enclosing state scope. */
  readonly lexical?: boolean;
  readonly children?: readonly SceneChildBinding[];
  readonly receiveProps?: (props: Readonly<Record<string, unknown>>) => void;
  readonly components?: readonly SceneComponent[];
  readonly regions?: readonly SceneRegionBinding[];
  readonly lists?: readonly SceneListBinding[];
}

export interface SceneEffectBinding {
  readonly index: number;
  readonly active: boolean;
  readonly sources: readonly string[];
  readonly read: () => readonly unknown[];
}

export interface SceneRefBinding {
  readonly node: number;
  readonly value: import('@memoized-dom/runtime/core').RefValue<SceneElement>;
}

/** Accepted native element capabilities; this is not a browser document node. */
export interface SceneElement {
  readonly handle: SceneHandle;
  readonly node: number;
  readonly tagName: string;
  readonly isConnected: boolean;
  readonly ownerDocument: null;
  readonly id: string;
  readonly value: string;
  getAttribute(name: string): string | null;
}

export type SceneRowKey = string | number;

export interface SceneListBinding {
  readonly node: number;
  readonly sources: readonly string[] | null;
  readonly component: SceneComponent;
  readonly read: () => readonly {
    readonly key: SceneRowKey;
    readonly props: Readonly<Record<string, unknown>>;
  }[];
}

export interface SceneRegionBinding {
  readonly node: number;
  readonly sources: readonly string[] | null;
  readonly branches: readonly (SceneComponent | null)[];
  readonly read: () => {
    readonly branch: number;
    readonly props: Readonly<Record<string, unknown>>;
  };
}

export interface SceneInstance {
  readonly entityId: string;
  readonly handle: SceneHandle;
  readonly ready: Promise<void>;
  readonly mounted: boolean;
  flush(): Promise<void>;
  /** Compiler callback routing; retired owners ignore late continuations. */
  invalidate(sources: readonly string[] | null): void;
  dispatch(event: number, payload?: unknown): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface DesktopApplication {
  /** Scope entry evaluation and programmatic callbacks to this core application. */
  run<T>(callback: () => T): T;
  mount<T>(factory: () => T): T;
  dispatch(handle: SceneHandle, event: number, payload?: unknown): Promise<unknown>;
  /** Dispatch one platform event through its authored ancestors and defaults. */
  dispatchEvent(event: NativeSceneEvent): Promise<boolean>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

interface ApplicationContext {
  mount(
    template: SceneTemplate,
    bindings: readonly TextBinding[],
    handlers: readonly SceneHandler[],
    options?: SceneMountOptions,
  ): SceneInstance;
}

let active: ApplicationContext | undefined;

export function sceneEvent(
  callback: SceneHandler['callback'],
  sources: readonly string[] | null,
): SceneHandler {
  return { callback, sources };
}
export function mountScene(
  template: SceneTemplate,
  bindings: readonly TextBinding[],
  handlers: readonly SceneHandler[],
  options?: SceneMountOptions,
): SceneInstance {
  if (!active) throw new Error('Mount a desktop component inside application.mount()');
  return active.mount(template, bindings, handlers, options);
}

/** Ownership, expression preparation and publication stay separate from entry evaluation. */
export function createDesktopApplication(host: DesktopHost): DesktopApplication {
  let closed = false;
  const semantic = createSceneSemanticRuntime();

  const forest = createOwnerForest(
    createPublicationQueue(host),
    () => closed,
    (factory) => {
      const previous = active;
      active = context;
      try {
        return semantic.run(factory);
      } finally {
        active = previous;
      }
    },
    semantic,
  );

  const context: ApplicationContext = forest;
  return {
    run(callback) {
      if (closed) throw new Error('Desktop application is disposed');
      return semantic.run(callback);
    },
    mount(factory) {
      if (closed) throw new Error('Desktop application is disposed');
      const previous = active;
      const before = new Set(forest.owners.keys());
      active = context;
      try {
        semantic.initialize(componentModules(factory));
        const result = semantic.run(factory);
        if (result instanceof Promise)
          throw new Error('Desktop mount factories must be synchronous');
        return result;
      } catch (error) {
        for (const instance of forest.owners.keys())
          if (!before.has(instance)) void instance.dispose().catch(() => {});
        throw error;
      } finally {
        active = previous;
      }
    },
    async dispatch(handle, event, payload) {
      if (closed) throw new Error('Desktop application is disposed');
      const instance = forest.find(handle);
      if (instance) return semantic.run(() => instance.dispatch(event, payload));
      throw new Error('Native desktop event targets an unknown or retired owner');
    },
    dispatchEvent(event) {
      return semantic.run(() => forest.dispatchEvent(event));
    },
    async flush() {
      await semantic.flush();
      const results = await Promise.allSettled(forest.roots().map((instance) => instance.flush()));
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length) throw new AggregateError(errors, 'Desktop scene publication failed');
    },
    async dispose() {
      closed = true;
      semantic.stopLifecycle();
      const results = await Promise.allSettled(
        forest.roots().map((instance) => instance.dispose()),
      );
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length) throw new AggregateError(errors, 'Desktop scene disposal failed');
      try {
        await semantic.flush();
      } finally {
        semantic.dispose();
      }
    },
  };
}
