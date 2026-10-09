import { createTreePreparer } from './tree-publication';
import type { SceneHandle, SceneOperation, SceneTemplate } from '../bridge/protocol';
import type { SceneHandler, SceneInstance, SceneMountOptions, TextBinding } from './application';
import type { createPublicationQueue } from './publication';
import type { Child, Family, Owner } from './ownership-model';
import { propValues, textValue, type SceneProps as Props } from './values';
import { componentTemplates, type SceneComponent } from './definitions';
import { readRegion, stagedReadiness } from './regions';

/** Independent lexical owners form a tree; one family queue protects its caches. */
export function createOwnerForest(publication: ReturnType<typeof createPublicationQueue>, isClosed: () => boolean, runFactory: <T>(factory: () => T) => T) {
  let nextId = 1;
  let placement: { family: Family; parent: Owner; node: number; staging: boolean } | undefined;
  const owners = new Map<SceneInstance, Owner>();
  const handles = new Map<number, Owner>();
  const installations = new WeakMap<SceneTemplate, Promise<void>>();

  const install = (template: SceneTemplate): Promise<void> => {
    let task = installations.get(template);
    if (!task) {
      task = publication.install(template);
      installations.set(template, task);
      void task.catch(() => { installations.delete(template); });
    }
    return task;
  };
  const invalidate = (owner: Owner, sources: readonly string[] | null): void => {
    owner.dirty = true;
    if (sources === null) owner.pending = null;
    else if (owner.pending) for (const source of sources) owner.pending.add(source);
  };
  const retire = (members: readonly Owner[]): void => {
    const retired = new Set(members);
    for (const member of members) {
      member.stagedReady?.reject(new Error('Desktop branch retired before publication'));
      member.mounted = false; member.disposed = true;
      owners.delete(member.instance); handles.delete(member.instance.handle.id);
      if (member.parent) {
        member.parent.children = member.parent.children.filter(child => child.owner !== member);
        for (const region of member.parent.regions) {
          if (region.child?.owner === member) region.child = undefined;
          if (region.candidate?.child.owner === member) region.candidate = undefined;
        }
      }
    }
    const families = new Set(members.map(member => member.family));
    for (const group of families) {
      group.members = group.members.filter(member => !retired.has(member));
      if (!group.members.length) group.root = undefined;
    }
    for (const member of members) {
      member.children = []; member.regions = []; member.parent = undefined;
      member.bindings = []; member.handlers = []; member.receive = undefined;
      member.initial = []; member.acknowledged.clear(); member.pending = new Set(); member.dirty = false;
    }
  };
  const owned = (owner: Owner): Owner[] => {
    const children = new Map<Owner, Owner[]>();
    for (const member of owner.family.members) if (member.parent) {
      let siblings = children.get(member.parent);
      if (!siblings) children.set(member.parent, siblings = []);
      siblings.push(member);
    }
    const result: Owner[] = []; const pending = [owner];
    while (pending.length) {
      const member = pending.pop()!; result.push(member);
      pending.push(...children.get(member) ?? []);
    }
    return result;
  };
  const construct = (parent: Owner, node: number, component: SceneComponent, props: Props, staging: boolean): Child => {
    const previous = placement;
    const before = new Set(parent.family.members);
    placement = { family: parent.family, parent, node, staging };
    try {
      const instance = runFactory(() => component(props));
      const owner = owners.get(instance);
      const roots = parent.family.members.filter(member => !before.has(member) && member.parent === parent);
      if (!owner || owner.parent !== parent || owner.attachment?.node !== node || roots.length !== 1 || roots[0] !== owner) throw new Error('Desktop child factory must return one compiled component owner');
      return { node, owner, props };
    } catch (error) {
      if (staging) retire(parent.family.members.filter(member => !before.has(member)));
      throw error;
    } finally { placement = previous; }
  };
  const acceptMount = (owner: Owner): void => {
    owner.mounted = true;
    for (const write of owner.initial) owner.acknowledged.set(write.slot, write.value);
    owner.stagedReady?.resolve();
    owner.stagedReady = undefined;
    owner.initial = [];
  };
  const mountOperation = (owner: Owner): SceneOperation => ({ kind: 'mount', handle: owner.instance.handle,
    template: owner.template.id, values: owner.initial, ...(owner.attachment ? { attach_to: owner.attachment } : {}) });
  const prepare = createTreePreparer({ invalidate, retire, owned, construct, acceptMount, mountOperation });
  const flush = (owner: Owner): Promise<void> => {
    const family = owner.family;
    const task = family.work.then(async () => {
      await family.ready;
      if (owner.disposed || !family.members.some(member => !member.disposed && member.dirty)) return;
      await publication.publish(() => prepare(family));
    });
    family.work = task.catch(() => {});
    return task;
  };
  const dispose = (owner: Owner): Promise<void> => {
    if (owner.parent?.disposed) return dispose(owner.parent);
    if (owner.disposal) return owner.disposal;
    if (owner.disposed && !owner.mounted) return owner.family.work;
    const members = owned(owner);
    for (const member of members) member.disposed = true;
    const release = (): void => retire(members);
    const task = owner.family.work.then(async () => {
      try { await owner.family.ready; } catch { release(); return; }
      if (owner.mounted) await publication.publish(() => ({
        operation: { kind: 'dispose', handle: owner.instance.handle }, accept: release, reject() {},
      }));
      else release();
    });
    owner.family.work = task.catch(() => {});
    owner.disposal = task.finally(() => { owner.disposal = undefined; });
    return owner.disposal;
  };
  const family = (): Family => {
    const group: Family = { members: [], installs: [], ready: Promise.resolve(), work: Promise.resolve(), failed: false };
    group.ready = Promise.resolve().then(async () => {
      try { await Promise.all(group.installs); } finally { group.installs = []; }
      if (group.failed) throw group.error;
      await publication.publish(() => {
        const live = group.members.filter(owner => !owner.disposed);
        const operations = live.map(mountOperation);
        return { operations, accept() {
          for (const owner of live) acceptMount(owner);
        }, reject() {} };
      });
    });
    void group.ready.catch(() => {});
    return group;
  };

  return {
    owners,
    find(handle: SceneHandle): SceneInstance | undefined {
      const owner = handles.get(handle.id);
      return owner?.instance.handle.generation === handle.generation ? owner.instance : undefined;
    },
    roots() { return [...owners.values()].filter(owner => !owner.parent).map(owner => owner.instance); },
    mount(template: SceneTemplate, bindings: readonly TextBinding[], handlers: readonly SceneHandler[], options: SceneMountOptions = {}): SceneInstance {
      if (isClosed()) throw new Error('Desktop application is disposed');
      if (bindings.length !== template.slots.length || handlers.length !== template.events.length) throw new Error('Desktop template bindings do not match its schema');
      const slots = new Set<number>();
      for (const binding of bindings) {
        if (!Number.isInteger(binding.slot) || !template.slots[binding.slot] || slots.has(binding.slot)) throw new Error('Invalid or duplicate desktop text binding');
        slots.add(binding.slot);
      }
      const parent = placement?.parent;
      const staging = placement?.staging ?? false;
      if (staging && !installations.has(template)) throw new Error('Desktop branch template was not installed before staging');
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.template.id === template.id) throw new Error('Recursive desktop component attachment is not implemented');
      }
      const initial = bindings.map(binding => ({ slot: binding.slot, value: textValue(binding.read()) }));
      const group = placement?.family ?? family();
      const attachment = placement ? { handle: placement.parent.instance.handle, node: placement.node } : undefined;
      const handle = Object.freeze({ id: nextId++, generation: 1 });
      const owner: Owner = { instance: undefined!, family: group, parent, attachment, template, bindings, handlers,
        receive: options.receiveProps, initial, children: [], regions: [], acknowledged: new Map(), pending: new Set(), dirty: false, disposed: false, mounted: false,
        stagedReady: staging ? stagedReadiness() : undefined };
      const instance: SceneInstance = {
        handle, ready: owner.stagedReady?.promise ?? group.ready,
        get mounted() { return owner.mounted; },
        flush() { return flush(owner); },
        async dispatch(event, payload) {
          await instance.ready;
          if (owner.disposed || isClosed()) throw new Error('Desktop event targets a disposed owner');
          if (!Number.isInteger(event) || !owner.handlers[event]) throw new Error('Unknown desktop event');
          const handler = owner.handlers[event]!;
          let result: unknown; let callbackError: unknown; let failed = false;
          try {
            result = Reflect.apply(handler.callback, undefined, [payload]);
            if (result instanceof Promise) throw new Error('Asynchronous desktop callbacks are not supported yet');
          } catch (error) { failed = true; callbackError = error; }
          invalidate(owner, handler.sources);
          try { await flush(owner); } catch (error) {
            if (failed) throw new AggregateError([callbackError, error], 'Desktop callback and publication failed');
            throw error;
          }
          if (failed) throw callbackError;
          return result;
        },
        dispose() { return dispose(owner); },
      };
      owner.instance = instance;
      group.members.push(owner); owners.set(instance, owner); handles.set(handle.id, owner); group.root ??= owner;
      if (!staging) group.installs.push(install(template));
      const regions = new Set<number>();
      try {
        for (const definition of componentTemplates(options.components ?? [])) {
          if (staging && !installations.has(definition)) throw new Error('Desktop branch dependency was not installed before staging');
          if (!staging) group.installs.push(install(definition));
        }
        for (const binding of options.children ?? []) {
          if (template.nodes[binding.node]?.kind !== 'region' || regions.has(binding.node)) throw new Error('Invalid or duplicate desktop component region');
          regions.add(binding.node);
          const props = propValues(binding.read());
          const child = construct(owner, binding.node, binding.component, props, staging);
          owner.children.push({ ...child, binding });
        }
        for (const binding of options.regions ?? []) {
          if (template.nodes[binding.node]?.kind !== 'region' || regions.has(binding.node)) throw new Error('Invalid or duplicate desktop component region');
          regions.add(binding.node);
          const next = readRegion(binding);
          const child = next.component ? construct(owner, binding.node, next.component, next.props, staging) : undefined;
          owner.regions.push({ binding, branch: next.branch, child });
          if (child) owner.children.push(child);
        }
        owner.children.sort((a,b) => a.node-b.node);
      } catch (error) { if (!staging) { group.failed = true; group.error = error; } throw error; }
      return instance;
    },
  };
}
