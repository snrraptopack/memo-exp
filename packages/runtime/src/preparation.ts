/**
 * Internal lifecycle foundation for detached subtree preparation.
 * The caller still owns DOM publication. Read scopes track only resources
 * consumed by active renders, not resource declarations or mounted effects.
 */
import { cleanup } from './cleanup';
import {
  getActiveApplicationRuntime,
  getEntity,
  markDirty,
  runWithApplicationRuntime,
  unregisterSubtree,
  type Entity,
  type PreparationDependency,
  type RenderPreparationOwner,
} from './kernel';

export interface RenderPreparation extends RenderPreparationOwner {
  run<T>(render: () => T): T;
  collect<T>(owner: string, render: () => T, site?: string): T;
  readonly readiness: 'pending' | 'ready' | 'error';
  readonly errors: readonly unknown[];
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
  type ReadScope = { owner: string; site: string; keys: Set<object> };
  const reads = new Map<string, Map<string, ReadScope>>();
  const dependencies = new Map<object, {
    resource: PreparationDependency;
    consumers: Set<ReadScope>;
    unsubscribe: () => void;
  }>();
  let collecting: ReadScope | undefined;
  let rendering = 0;
  let status: RenderPreparation['status'] = 'pending';
  let ready = false;

  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const dropRead = (scope: ReadScope, key: object): void => {
    const entry = dependencies.get(key);
    if (entry === undefined) return;
    entry.consumers.delete(scope);
    if (entry.consumers.size === 0) {
      dependencies.delete(key);
      entry.unsubscribe();
    }
  };
  const dropOwner = (owner: string): void => {
    for (const scope of reads.get(owner)?.values() ?? []) {
      for (const key of scope.keys) dropRead(scope, key);
    }
    reads.delete(owner);
  };
  const ownReadiness = (): RenderPreparation['readiness'] => {
    if (status === 'disposed') return 'pending';
    if (status === 'active') return 'ready';
    // A settled source may have dirtied a conditional that has not yet
    // discovered its next child resource. Never publish between those steps.
    if (rendering !== 0 || [...entities.values()].some(entity =>
      entity.phase !== 'effect' && runtime.state.dirty.has(entity.id))) return 'pending';
    let pending = false;
    for (const { resource } of dependencies.values()) {
      const snapshot = resource.snapshot();
      if (snapshot.status === 'error') return 'error';
      if (snapshot.status === 'pending') pending = true;
    }
    for (const child of children) {
      if (child.status !== 'pending') continue;
      if (child.readiness === 'error') return 'error';
      if (child.readiness !== 'ready') pending = true;
    }
    return pending ? 'pending' : 'ready';
  };
  const preparation: RenderPreparation = {
    get status() { return status; },
    get readiness() { return ownReadiness(); },
    get errors() {
      const errors: unknown[] = [];
      for (const { resource } of dependencies.values()) {
        const snapshot = resource.snapshot();
        if (snapshot.status === 'error') errors.push(snapshot.error);
      }
      for (const child of children) {
        if (child.status === 'pending') errors.push(...child.errors);
      }
      return errors;
    },
    run<T>(render: () => T): T {
      if (status === 'disposed') {
        throw new Error('[memo-dom] cannot render a disposed preparation');
      }
      return inRuntime(() => {
        if (status === 'active') return render();
        const previous = runtime.state.preparation;
        runtime.state.preparation = preparation;
        rendering++;
        try { return render(); }
        catch (error) {
          try { preparation.dispose(); }
          catch (rollback) {
            throw new AggregateError([error, rollback], '[memo-dom] preparation and rollback failed');
          }
          throw error;
        }
        finally { rendering--; runtime.state.preparation = previous; }
      });
    },
    collect<T>(owner: string, render: () => T, site = 'render'): T {
      return preparation.run(() => {
        if (status === 'active') return render();
        if (!entities.has(owner)) {
          throw new Error(`[memo-dom] preparation read owner '${owner}' is not registered`);
        }
        const previous = collecting;
        const current = { owner, site, keys: new Set<object>() };
        collecting = current;
        try { return render(); }
        finally {
          collecting = previous;
          if (status === 'pending' && entities.has(owner)) {
            // Same-site reentrant renders would replace an incomplete read
            // set. Merge them into the surrounding render instead.
            if (previous?.owner === owner && previous.site === site) {
              for (const key of current.keys) previous.keys.add(key);
              for (const key of current.keys) {
                const entry = dependencies.get(key);
                entry?.consumers.add(previous);
                entry?.consumers.delete(current);
              }
            } else {
              let sites = reads.get(owner);
              if (sites === undefined) { sites = new Map(); reads.set(owner, sites); }
              // New claims were attached during rendering. Remove the old
              // site claims afterwards, without interrupting shared observers.
              for (const key of sites.get(site)?.keys ?? []) {
                dropRead(sites.get(site)!, key);
              }
              sites.set(site, current);
            }
          } else if (status === 'pending') {
            for (const key of current.keys) dropRead(current, key);
          }
        }
      });
    },
    consume(resource) {
      if (status !== 'pending' || collecting === undefined) return;
      const { keys } = collecting;
      keys.add(resource.key);
      const existing = dependencies.get(resource.key);
      if (existing !== undefined) { existing.consumers.add(collecting); return; }
      const entry = { resource, consumers: new Set([collecting]), unsubscribe: () => {} };
      dependencies.set(resource.key, entry);
      let subscribing = true;
      entry.unsubscribe = resource.subscribe(() => {
        if (subscribing || status !== 'pending' || dependencies.get(resource.key) !== entry) return;
        inRuntime(() => {
          // Deduplicate owners and snapshot them before synchronous replay.
          const owners = new Set([...entry.consumers].map(scope => scope.owner));
          for (const id of owners) {
            if (entities.get(id) === getEntity(id)) markDirty(id);
          }
        });
      });
      subscribing = false;
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
        // Updates are incremental. Compiler-owned read scopes must wrap only
        // the sinks actually replayed; do not clear untouched sink claims here.
        preparation.run(() => render.call(entity, reasons));
      };
      entities.set(entity.id, entity);
      cleanup(entity.id, () => {
        dropOwner(entity.id);
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
      if (ownReadiness() !== 'ready') {
        throw new Error('[memo-dom] cannot activate before consumed resources and render discovery are ready');
      }
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
        // Observation is borrowed: dropping a claim never aborts a shared source.
        // Like entity cleanup, adapters release inside their captured runtime.
        for (const entry of dependencies.values()) {
          try { entry.unsubscribe(); } catch (error) { errors.push(error); }
        }
        dependencies.clear();
        reads.clear();
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
    for (const entry of dependencies.values()) entry.unsubscribe();
    dependencies.clear();
    reads.clear();
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
  return preparation.readiness === 'ready' && readiness.get(preparation)?.() === true &&
    [...descendants.get(preparation) ?? []].every(child =>
      child.status !== 'pending' || isReady(child));
}
