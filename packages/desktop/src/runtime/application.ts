import type { DesktopHost, SceneHandle, SceneTemplate, TextWrite } from '../bridge/protocol';
import { createPublicationQueue } from './publication';

export interface TextBinding {
  readonly slot: number;
  readonly sources: readonly string[] | null;
  readonly read: () => unknown;
}
export interface SceneHandler {
  readonly callback: (event: unknown) => unknown;
  readonly sources: readonly string[] | null;
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
  mount(template: SceneTemplate, bindings: readonly TextBinding[], handlers: readonly SceneHandler[]): SceneInstance;
}
let active: ApplicationContext | undefined;

/** Event metadata is captured once; authored callbacks keep their own lexical state. */
export function sceneEvent(callback: SceneHandler['callback'], sources: readonly string[] | null): SceneHandler {
  return { callback, sources };
}

export function mountScene(template: SceneTemplate, bindings: readonly TextBinding[], handlers: readonly SceneHandler[]): SceneInstance {
  if (!active) throw new Error('Mount a desktop component inside application.mount()');
  return active.mount(template, bindings, handlers);
}

/** Ordered host publication for one application; host acceptance advances value caches. */
export function createDesktopApplication(host: DesktopHost): DesktopApplication {
  let nextId = 1;
  let closed = false;
  const publication = createPublicationQueue(host);
  const instances = new Set<SceneInstance>();
  const installations = new WeakMap<SceneTemplate, Promise<void>>();
  const context: ApplicationContext = {
    mount(template, bindings, handlers) {
      if (closed) throw new Error('Desktop application is disposed');
      if (bindings.length !== template.slots.length || handlers.length !== template.events.length) {
        throw new Error('Desktop template bindings do not match its schema');
      }
      const slots = new Set<number>();
      for (const binding of bindings) {
        if (!Number.isInteger(binding.slot) || !template.slots[binding.slot] || slots.has(binding.slot)) {
          throw new Error('Invalid or duplicate desktop text binding');
        }
        slots.add(binding.slot);
      }
      // Evaluate authored expressions before allocating/queuing a live host instance.
      const initial = bindings.map(binding => ({ slot: binding.slot, value: textValue(binding.read()) }));
      const handle = Object.freeze({ id: nextId++, generation: 1 });
      const acknowledged = new Map<number, string>();
      let disposed = false;
      let mounted = false;
      let pending: Set<string> | null = new Set();
      let needsUpdate = false;
      let work = Promise.resolve();
      let disposal: Promise<void> | undefined;
      let install = installations.get(template);
      if (!install) {
        install = publication.install(template);
        installations.set(template, install);
        void install.catch(() => { installations.delete(template); });
      }
      const ready = install.then(() => publication.publish(() => ({
        operation: { kind: 'mount', handle, template: template.id, values: initial },
        accept() { mounted = true; for (const write of initial) acknowledged.set(write.slot, write.value); },
        reject() {},
      })));
      // Keep rejection observable through ready/flush without an unhandled rejection
      // when a synchronous factory caller has not yet awaited initial publication.
      void ready.catch(() => {});
      const invalidate = (sources: readonly string[] | null): void => {
        needsUpdate = true;
        if (sources === null) pending = null;
        else if (pending) for (const source of sources) pending.add(source);
      };
      const instance: SceneInstance = {
        handle, ready,
        get mounted() { return mounted; },
        flush() {
          const task = work.then(async () => {
            await ready;
            if (disposed || !needsUpdate) return;
            await publication.publish(() => {
              if (disposed || !needsUpdate) return { accept() {}, reject() {} };
              const sources = pending;
              const writes: TextWrite[] = [];
              for (const binding of bindings) {
                if (sources !== null && binding.sources !== null && !binding.sources.some(source => sources.has(source))) continue;
                const value = textValue(binding.read());
                if (acknowledged.get(binding.slot) !== value) writes.push({ slot: binding.slot, value });
              }
              needsUpdate = false;
              pending = new Set();
              return {
                operation: writes.length ? { kind: 'update', handle, values: writes } : undefined,
                accept() { for (const write of writes) acknowledged.set(write.slot, write.value); },
                reject() { invalidate(sources === null ? null : [...sources]); },
              };
            });
          });
          work = task.catch(() => {});
          return task;
        },
        async dispatch(event, payload) {
          await ready;
          if (disposed || closed) throw new Error('Desktop event targets a disposed owner');
          if (!Number.isInteger(event) || !handlers[event]) throw new Error('Unknown desktop event');
          const handler = handlers[event]!;
          let result: unknown;
          let callbackError: unknown;
          let failed = false;
          try {
            result = Reflect.apply(handler.callback, undefined, [payload]);
            if (result instanceof Promise) throw new Error('Asynchronous desktop callbacks are not supported yet');
          } catch (error) { failed = true; callbackError = error; }
          invalidate(handler.sources);
          try { await instance.flush(); } catch (error) {
            if (failed) throw new AggregateError([callbackError, error], 'Desktop callback and publication failed');
            throw error;
          }
          if (failed) throw callbackError;
          return result;
        },
        dispose() {
          if (disposal) return disposal;
          if (disposed && !mounted) return work;
          disposed = true;
          const task = work.then(async () => {
            try { await ready; } catch { instances.delete(instance); return; }
            if (mounted) await publication.publish(() => ({
              operation: { kind: 'dispose', handle },
              accept() { mounted = false; instances.delete(instance); },
              reject() {},
            }));
            else instances.delete(instance);
          });
          work = task.catch(() => {});
          disposal = task.finally(() => { disposal = undefined; });
          return disposal;
        },
      };
      instances.add(instance);
      return instance;
    },
  };
  return {
    mount(factory) {
      if (closed) throw new Error('Desktop application is disposed');
      const previous = active;
      const before = new Set(instances);
      active = context;
      try {
        const result = factory();
        if (result instanceof Promise) throw new Error('Desktop mount factories must be synchronous');
        return result;
      } catch (error) {
        for (const instance of instances) if (!before.has(instance)) void instance.dispose().catch(() => {});
        throw error;
      } finally { active = previous; }
    },
    async dispatch(handle, event, payload) {
      if (closed) throw new Error('Desktop application is disposed');
      for (const instance of instances) {
        if (instance.handle.id === handle.id && instance.handle.generation === handle.generation) {
          return instance.dispatch(event, payload);
        }
      }
      throw new Error('Native desktop event targets an unknown or retired owner');
    },
    async flush() {
      const results = await Promise.allSettled([...instances].map(instance => instance.flush()));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Desktop scene publication failed');
    },
    async dispose() {
      closed = true;
      const results = await Promise.allSettled([...instances].map(instance => instance.dispose()));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length) throw new AggregateError(errors, 'Desktop scene disposal failed');
    },
  };
}

function textValue(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (!['string', 'number', 'bigint'].includes(typeof value)) {
    throw new TypeError('Desktop text expressions currently require a primitive value');
  }
  return String(value);
}
