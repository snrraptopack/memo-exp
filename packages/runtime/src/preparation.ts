/**
 * Internal lifecycle foundation for detached subtree preparation. This is not
 * a readiness coordinator: the caller still owns DOM publication and must
 * prove readiness before activation. Resource discovery/compiler integration
 * is deliberately separate.
 */
import { cleanup } from './cleanup';
import {
  getActiveApplicationRuntime,
  getEntity,
  markDirty,
  runWithApplicationRuntime,
  unregisterSubtree,
  type Entity,
  type RenderPreparationOwner,
} from './kernel';

export interface RenderPreparation extends RenderPreparationOwner {
  run<T>(render: () => T): T;
  activate(): void;
  dispose(): void;
  readonly status: 'pending' | 'active' | 'disposed';
}

/** @internal Start one request/runtime-owned activation generation. */
export function createRenderPreparation(): RenderPreparation {
  const runtime = getActiveApplicationRuntime();
  const parent = runtime.state.preparation as RenderPreparation | undefined;
  const entities = new Map<string, Entity>();
  const refs = new Set<() => void>();
  const children = new Set<RenderPreparation>();
  let status: RenderPreparation['status'] = 'pending';
  let ready = false;

  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const preparation: RenderPreparation = {
    get status() { return status; },
    run<T>(render: () => T): T {
      if (status === 'disposed') {
        throw new Error('[memo-dom] cannot render a disposed preparation');
      }
      return inRuntime(() => {
        if (status === 'active') return render();
        const previous = runtime.state.preparation;
        runtime.state.preparation = preparation;
        try { return render(); }
        catch (error) {
          try { preparation.dispose(); }
          catch (rollback) {
            throw new AggregateError([error, rollback], '[memo-dom] preparation and rollback failed');
          }
          throw error;
        }
        finally { runtime.state.preparation = previous; }
      });
    },
    attach(entity) {
      if (status === 'disposed') {
        throw new Error('[memo-dom] cannot attach to a disposed preparation');
      }
      if (status === 'active') return;
      if (getEntity(entity.id) !== undefined) {
        throw new Error(`[memo-dom] preparation cannot overwrite live entity '${entity.id}'`);
      }
      entity.preparation = preparation;
      const render = entity.render;
      entity.render = reasons => {
        if (status === 'disposed') return;
        if (status === 'pending' && entity.phase === 'effect') return;
        preparation.run(() => render.call(entity, reasons));
      };
      entities.set(entity.id, entity);
      cleanup(entity.id, () => {
        if (entities.get(entity.id) === entity) entities.delete(entity.id);
        if (entities.size === 0) preparation.dispose();
      });
    },
    deferRef(activate) {
      if (status !== 'pending') {
        throw new Error('[memo-dom] refs can only be queued during preparation');
      }
      refs.add(activate);
      return () => { refs.delete(activate); };
    },
    activate() {
      if (status !== 'pending') return;
      // Nested generations may become ready independently, but their mounted
      // lifecycle must remain held until the uncommitted outer generation.
      ready = true;
      if (parent?.status === 'pending') return;
      inRuntime(() => {
        for (const child of children) {
          if (child.status === 'pending' && !isReady(child)) {
            throw new Error('[memo-dom] cannot activate before nested preparation is ready');
          }
        }
        const previous = runtime.state.preparation;
        runtime.state.preparation = undefined;
        const effects: Entity[] = [];
        try {
          releases.get(preparation)!(effects);
        } catch (error) {
          try { preparation.dispose(); }
          catch (rollback) {
            throw new AggregateError([error, rollback], '[memo-dom] activation and rollback failed');
          }
          throw error;
        } finally {
          runtime.state.preparation = previous;
        }
        // All sibling/nested ref assignments precede every mounted effect,
        // including with an injected synchronous scheduler. Effect exceptions
        // remain ordinary mounted-effect errors, outside render rollback.
        effects.sort((left, right) => (left.depth ?? 0) - (right.depth ?? 0));
        for (const entity of effects) {
          if (getEntity(entity.id) === entity) markDirty(entity.id);
        }
      });
    },
    dispose() {
      if (status === 'disposed') return;
      status = 'disposed';
      refs.clear();
      const errors: unknown[] = [];
      inRuntime(() => {
        for (const child of children) {
          try { child.dispose(); } catch (error) { errors.push(error); }
        }
        for (const entity of entities.values()) {
          if (getEntity(entity.id) !== entity) continue;
          try { unregisterSubtree(entity.id); } catch (error) { errors.push(error); }
        }
        entities.clear();
      });
      if (parent !== undefined) descendants.get(parent)?.delete(preparation);
      children.clear();
      readiness.delete(preparation);
      descendants.delete(preparation);
      releases.delete(preparation);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, '[memo-dom] preparation rollback failed');
    },
  };
  readiness.set(preparation, () => ready);
  releases.set(preparation, effects => {
    if (status !== 'pending') return;
    status = 'active';
    for (const entity of entities.values()) delete entity.preparation;
    const activateRefs = [...refs];
    refs.clear();
    for (const activate of activateRefs) activate();
    for (const child of children) releases.get(child)?.(effects);
    for (const entity of entities.values()) {
      if (entity.phase === 'effect') effects.push(entity);
    }
  });
  if (parent !== undefined) {
    const siblings = descendants.get(parent);
    siblings?.add(preparation);
  }
  descendants.set(preparation, children);
  return preparation;
}

const readiness = new WeakMap<RenderPreparation, () => boolean>();
const descendants = new WeakMap<RenderPreparation, Set<RenderPreparation>>();
const releases = new WeakMap<RenderPreparation, (effects: Entity[]) => void>();
function isReady(preparation: RenderPreparation): boolean {
  return readiness.get(preparation)?.() === true &&
    [...descendants.get(preparation) ?? []].every(child =>
      child.status !== 'pending' || isReady(child));
}
