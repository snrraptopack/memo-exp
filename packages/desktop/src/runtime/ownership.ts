import { createTreePreparer } from './tree-publication';
import type { SceneHandle, SceneOperation, SceneTemplate } from '../bridge/protocol';
import { createEventDispatcher } from './event-dispatch';
import type { SceneHandler, SceneInstance, SceneMountOptions, TextBinding } from './application';
import type { createPublicationQueue } from './publication';
import type { Child, Family, Owner } from './ownership-model';
import { propValues, textValue, type SceneProps as Props, type SceneCallback } from './values';
import { componentTemplates, type SceneComponent } from './definitions';
import { readRegion, stagedReadiness } from './regions';
import { readList } from './lists';
import type { SceneSemanticRuntime } from './semantic';
import { configureOwnerLifecycle } from './lifecycle';

/** Independent lexical owners form a tree; one family queue protects its caches. */
export function createOwnerForest(
  publication: ReturnType<typeof createPublicationQueue>,
  isClosed: () => boolean,
  runFactory: <T>(factory: () => T) => T,
  semantic: SceneSemanticRuntime,
) {
  let nextId = 1;
  let placement: { family: Family; parent: Owner; node: number; staging: boolean } | undefined;
  const owners = new Map<SceneInstance, Owner>();
  const handles = new Map<number, Owner>();
  const installations = new WeakMap<SceneTemplate, Promise<void>>();
  const ownedCallbacks = new WeakSet<SceneCallback>();

  const install = (template: SceneTemplate): Promise<void> => {
    let task = installations.get(template);
    if (!task) {
      task = publication.install(template);
      installations.set(template, task);
      void task.catch(() => {
        installations.delete(template);
      });
    }
    return task;
  };
  const invalidate = (owner: Owner, sources: readonly string[] | null): void => {
    const pending = [owner];
    while (pending.length) {
      const member = pending.pop()!;
      if (member.disposed) continue;
      member.dirty = true;
      if (sources === null) member.pending = null;
      else if (member.pending) for (const source of sources) member.pending.add(source);
      pending.push(...member.lexicalChildren);
    }
  };
  const stateOwner = (owner: Owner): Owner => {
    // An inline handler writes the enclosing closure. Named components remain
    // independent owners, even when mounted inside an inline fragment.
    while (owner.lexicalParent) owner = owner.lexicalParent;
    return owner;
  };
  const invalidateState = (owner: Owner, sources: readonly string[] | null): void => {
    if (sources?.length === 0) return;
    const target = stateOwner(owner);
    invalidate(target, sources);
    semantic.invalidateLocal(target.entityId);
  };
  const retire = (members: readonly Owner[]): void => {
    const retired = new Set(members);
    const parents = new Set<Owner>();
    for (const member of members) {
      semantic.unregister(member.entityId);
      member.stagedReady?.reject(new Error('Desktop branch retired before publication'));
      member.mounted = false;
      member.disposed = true;
      owners.delete(member.instance);
      handles.delete(member.instance.handle.id);
      if (member.parent && !retired.has(member.parent)) parents.add(member.parent);
    }
    // Retiring many siblings must not repeatedly filter the same parent arrays.
    for (const parent of parents) {
      parent.children = parent.children.filter((child) => !retired.has(child.owner));
      for (const region of parent.regions) {
        if (region.child && retired.has(region.child.owner)) region.child = undefined;
        if (region.candidate && retired.has(region.candidate.child.owner))
          region.candidate = undefined;
      }
      for (const list of parent.lists) {
        list.rows = list.rows.filter((row) => !retired.has(row.owner));
        for (const [key, row] of list.candidates)
          if (retired.has(row.owner)) list.candidates.delete(key);
      }
    }
    const families = new Set(members.map((member) => member.family));
    for (const group of families) {
      group.members = group.members.filter((member) => !retired.has(member));
      if (!group.members.length) {
        group.root = undefined;
        semantic.releaseHold(group.ready);
      }
    }
    for (const member of members) {
      member.lexicalParent?.lexicalChildren.delete(member);
      member.lexicalParent = undefined;
      member.lexicalChildren.clear();
      member.children = [];
      member.regions = [];
      member.lists = [];
      member.parent = undefined;
      member.bindings = [];
      member.handlers = [];
      member.receive = undefined;
      member.prepare = undefined;
      member.activate = undefined;
      member.effectInvalidations = undefined;
      member.initial = [];
      member.acknowledged.clear();
      member.pending = new Set();
      member.dirty = false;
    }
  };
  const owned = (roots: Owner | readonly Owner[]): Owner[] => {
    const pending: Owner[] = 'family' in roots ? [roots] : [...roots];
    const family = pending[0]?.family;
    if (!family) return [];
    const children = new Map<Owner, Owner[]>();
    for (const member of family.members)
      if (member.parent) {
        let siblings = children.get(member.parent);
        if (!siblings) children.set(member.parent, (siblings = []));
        siblings.push(member);
      }
    const result: Owner[] = [];
    const visited = new Set<Owner>();
    while (pending.length) {
      const member = pending.pop()!;
      if (visited.has(member)) continue;
      visited.add(member);
      result.push(member);
      pending.push(...(children.get(member) ?? []));
    }
    return result;
  };
  const construct = (
    parent: Owner,
    node: number,
    component: SceneComponent,
    props: Props,
    staging: boolean,
  ): Child => {
    const previous = placement;
    const offset = parent.family.members.length;
    placement = { family: parent.family, parent, node, staging };
    try {
      const instance = runFactory(() => component(props));
      const owner = owners.get(instance);
      const roots = parent.family.members
        .slice(offset)
        .filter((member) => member.parent === parent);
      if (
        !owner ||
        owner.parent !== parent ||
        owner.attachment?.node !== node ||
        roots.length !== 1 ||
        roots[0] !== owner
      )
        throw new Error('Desktop child factory must return one compiled component owner');
      return { node, owner, props };
    } catch (error) {
      if (staging) retire(parent.family.members.slice(offset));
      throw error;
    } finally {
      placement = previous;
    }
  };
  const acceptMount = (owner: Owner): void => {
    owner.mounted = true;
    for (const write of owner.initial) owner.acknowledged.set(write.slot, write.value);
    owner.stagedReady?.resolve();
    owner.stagedReady = undefined;
    owner.initial = [];
    semantic.activate(owner.entityId, () => owner.activate?.());
  };
  const mountOperation = (owner: Owner): SceneOperation => ({
    kind: 'mount',
    handle: owner.instance.handle,
    template: owner.template.id,
    values: owner.initial,
    ...(owner.attachment ? { attach_to: owner.attachment } : {}),
  });
  const prepare = createTreePreparer({
    invalidate,
    retire,
    owned,
    construct,
    acceptMount,
    mountOperation,
  });
  const flush = (owner: Owner): Promise<void> => {
    const family = owner.family;
    const task = family.work.then(async () => {
      await family.ready;
      if (family.failed) throw family.error;
      if (owner.disposed || !family.members.some((member) => !member.disposed && member.dirty))
        return;
      await publication.publish(() => prepare(family));
    });
    family.work = task.catch(() => {});
    return task;
  };
  // Resolve the lexical owner before queuing: an accepted inline subtree can
  // retire while the queue waits, but its earlier state write still belongs to
  // the live enclosing owner and must reach the replacement subtree.
  const flushState = (owner: Owner): Promise<void> =>
    semantic.flush(() => flush(stateOwner(owner)), owner.family);
  const dispose = (owner: Owner): Promise<void> => {
    if (owner.parent?.disposed) return dispose(owner.parent);
    if (owner.disposal) return owner.disposal;
    if (owner.disposed && !owner.mounted) return owner.family.work;
    const members = owned(owner);
    for (const member of members) member.disposed = true;
    const release = (): void => retire(members);
    const task = owner.family.work.then(async () => {
      try {
        await owner.family.ready;
      } catch {
        release();
        return;
      }
      if (owner.mounted)
        await publication.publish(() => {
          const operations: SceneOperation[] = [{ kind: 'dispose', handle: owner.instance.handle }];
          const parent = owner.parent;
          const list = parent?.lists.find((list) => list.rows.some((row) => row.owner === owner));
          if (parent && list)
            operations.push({
              kind: 'order',
              handle: parent.instance.handle,
              node: list.binding.node,
              children: list.rows
                .filter((row) => row.owner !== owner)
                .map((row) => row.owner.instance.handle),
            });
          return { operations, accept: release, reject() {} };
        });
      else release();
    });
    owner.family.work = task.catch(() => {});
    owner.disposal = task.finally(() => {
      owner.disposal = undefined;
    });
    return owner.disposal;
  };
  const family = (): Family => {
    const group: Family = {
      members: [],
      installs: [],
      ready: Promise.resolve(),
      work: Promise.resolve(),
      failed: false,
    };
    group.ready = Promise.resolve().then(async () => {
      try {
        await Promise.all(group.installs);
      } finally {
        group.installs = [];
      }
      if (group.failed) throw group.error;
      await publication.publish(() => {
        const live = group.members.filter((owner) => !owner.disposed);
        const operations = [
          ...live.map(mountOperation),
          ...live.flatMap((owner) =>
            owner.lists.map((list) => ({
              kind: 'order' as const,
              handle: owner.instance.handle,
              node: list.binding.node,
              children: list.rows.map((row) => row.owner.instance.handle),
            })),
          ),
        ];
        return {
          operations,
          accept() {
            for (const owner of live) acceptMount(owner);
          },
          reject() {},
        };
      });
    });
    void group.ready.catch(() => {});
    semantic.hold(group.ready);
    return group;
  };

  const dispatchEvent = createEventDispatcher({
    find: (handle) => handles.get(handle.id),
    invalidate: invalidateState,
    flush: flushState,
    isClosed,
    reportAsync: semantic.reportAsync,
  });

  return {
    owners,
    dispatchEvent,
    find(handle: SceneHandle): SceneInstance | undefined {
      const owner = handles.get(handle.id);
      return owner?.instance.handle.generation === handle.generation ? owner.instance : undefined;
    },
    roots() {
      return [...owners.values()].filter((owner) => !owner.parent).map((owner) => owner.instance);
    },
    mount(
      template: SceneTemplate,
      bindings: readonly TextBinding[],
      handlers: readonly SceneHandler[],
      options: SceneMountOptions = {},
    ): SceneInstance {
      if (isClosed()) throw new Error('Desktop application is disposed');
      semantic.initialize(options.modules);
      if (bindings.length !== template.slots.length || handlers.length !== template.events.length)
        throw new Error('Desktop template bindings do not match its schema');
      const slots = new Set<number>();
      for (const binding of bindings) {
        if (
          !Number.isInteger(binding.slot) ||
          !template.slots[binding.slot] ||
          slots.has(binding.slot)
        )
          throw new Error('Invalid or duplicate desktop text binding');
        slots.add(binding.slot);
      }
      const parent = placement?.parent;
      const staging = placement?.staging ?? false;
      if (staging && !installations.has(template))
        throw new Error('Desktop branch template was not installed before staging');
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.template.id === template.id)
          throw new Error('Recursive desktop component attachment is not implemented');
      }
      const initial = bindings.map((binding) => ({
        slot: binding.slot,
        value: textValue(binding.read()),
      }));
      const group = placement?.family ?? family();
      const attachment = placement
        ? { handle: placement.parent.instance.handle, node: placement.node }
        : undefined;
      const handle = Object.freeze({ id: nextId++, generation: 1 });
      let callbacks: WeakMap<SceneCallback, SceneCallback> | undefined;
      const entityId = `${parent?.entityId ?? 'Desktop'}/${encodeURIComponent(template.id)}[${handle.id}]`;
      const owner: Owner = {
        entityId,
        instance: undefined!,
        family: group,
        parent,
        attachment,
        template,
        bindings,
        handlers,
        readProps: (props) =>
          propValues(props, (callback) => {
            // Forwarding preserves the declaring owner and stable callback identity.
            if (ownedCallbacks.has(callback)) return callback;
            let bound = callbacks?.get(callback);
            if (!bound) {
              bound = function (this: unknown, ...args: unknown[]) {
                if (owner.disposed || isClosed())
                  throw new Error('Desktop callback targets a disposed owner');
                try {
                  const result = Reflect.apply(callback, this, args);
                  if (result instanceof Promise)
                    return result.finally(() => invalidateState(owner, null));
                  return result;
                } finally {
                  invalidateState(owner, null);
                }
              };
              (callbacks ??= new WeakMap()).set(callback, bound);
              ownedCallbacks.add(bound);
            }
            return bound;
          }),
        lexicalParent: options.lexical ? parent : undefined,
        lexicalChildren: new Set(),
        receive: options.receiveProps,
        prepare: options.prepare,
        initial,
        children: [],
        regions: [],
        lists: [],
        acknowledged: new Map(),
        pending: new Set(),
        dirty: false,
        disposed: false,
        mounted: false,
        stagedReady: staging ? stagedReadiness() : undefined,
      };
      const instance: SceneInstance = {
        handle,
        entityId,
        ready: owner.stagedReady?.promise ?? group.ready,
        get mounted() {
          return owner.mounted;
        },
        invalidate(sources) {
          if (!owner.disposed && !isClosed()) invalidateState(owner, sources);
        },
        flush() {
          return semantic.flush(() => flush(owner), group);
        },
        async dispatch(event, payload) {
          return semantic.run(async () => {
            await instance.ready;
            if (owner.disposed || isClosed())
              throw new Error('Desktop event targets a disposed owner');
            if (!Number.isInteger(event) || !owner.handlers[event])
              throw new Error('Unknown desktop event');
            const handler = owner.handlers[event]!;
            let result: unknown;
            let callbackError: unknown;
            let failed = false;
            try {
              result = Reflect.apply(handler.callback, undefined, [payload]);
              if (result instanceof Promise) {
                // Observe immediately, including when native publication fails
                // before the authored continuation settles.
                void result.catch(() => {});
                invalidateState(owner, handler.sources);
                await flushState(owner);
                result = await result;
              }
            } catch (error) {
              failed = true;
              callbackError = error;
            }
            invalidateState(owner, handler.sources);
            try {
              await flushState(owner);
            } catch (error) {
              if (failed)
                throw new AggregateError(
                  [callbackError, error],
                  'Desktop callback and publication failed',
                );
              throw error;
            }
            if (failed) throw callbackError;
            return result;
          });
        },
        dispose() {
          return dispose(owner);
        },
      };
      owner.instance = instance;
      owner.lexicalParent?.lexicalChildren.add(owner);
      group.members.push(owner);
      owners.set(instance, owner);
      handles.set(handle.id, owner);
      group.root ??= owner;
      semantic.register(entityId, parent?.entityId ?? 'Desktop', (full) => {
        if (owner.disposed) return;
        if (full) invalidate(owner, null);
        semantic.request(group, () => flush(stateOwner(owner)));
      });
      configureOwnerLifecycle(owner, options);
      if (!staging) group.installs.push(install(template));
      const regions = new Set<number>();
      try {
        for (const definition of componentTemplates([
          ...(options.components ?? []),
          ...(options.lists ?? []).map((list) => list.component),
        ])) {
          if (staging && !installations.has(definition))
            throw new Error('Desktop branch dependency was not installed before staging');
          if (!staging) group.installs.push(install(definition));
        }
        for (const binding of options.children ?? []) {
          if (template.nodes[binding.node]?.kind !== 'region' || regions.has(binding.node))
            throw new Error('Invalid or duplicate desktop component region');
          regions.add(binding.node);
          const props = owner.readProps(binding.read());
          const child = construct(owner, binding.node, binding.component, props, staging);
          owner.children.push({ ...child, binding });
        }
        for (const binding of options.regions ?? []) {
          if (template.nodes[binding.node]?.kind !== 'region' || regions.has(binding.node))
            throw new Error('Invalid or duplicate desktop component region');
          regions.add(binding.node);
          const next = readRegion(binding, owner.readProps);
          const child = next.component
            ? construct(owner, binding.node, next.component, next.props, staging)
            : undefined;
          owner.regions.push({ binding, branch: next.branch, child });
          if (child) owner.children.push(child);
        }
        for (const binding of options.lists ?? []) {
          const node = template.nodes[binding.node];
          if (node?.kind !== 'region' || !node.multiple || regions.has(binding.node))
            throw new Error('Invalid or duplicate desktop list region');
          regions.add(binding.node);
          const values = readList(binding, owner.readProps);
          const list = {
            binding,
            rows: values.map((value) => ({
              ...construct(owner, binding.node, binding.component, value.props, staging),
              key: value.key,
            })),
            candidates: new Map(),
          };
          owner.lists.push(list);
          owner.children.push(...list.rows);
        }
        owner.children.sort((a, b) => a.node - b.node);
      } catch (error) {
        if (!staging) {
          group.failed = true;
          group.error = error;
        }
        throw error;
      }
      return instance;
    },
  };
}
