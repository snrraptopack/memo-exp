import type { SceneAttachment, SceneHandle, SceneOperation, SceneTemplate, TextWrite } from '../bridge/protocol';
import type { SceneChildBinding, SceneHandler, SceneInstance, SceneMountOptions, TextBinding } from './application';
import type { PreparedPublication, createPublicationQueue } from './publication';

type Props = Readonly<Record<string, unknown>>;
interface Child { binding: SceneChildBinding; owner: Owner; props: Props }
interface Family {
  members: Owner[];
  installs: Promise<void>[];
  ready: Promise<void>;
  root?: Owner;
  error?: unknown;
  failed: boolean;
  work: Promise<void>;
}
interface Owner {
  instance: SceneInstance;
  family: Family;
  parent?: Owner;
  attachment?: SceneAttachment;
  template: SceneTemplate;
  bindings: readonly TextBinding[];
  handlers: readonly SceneHandler[];
  receive?: (props: Props) => void;
  children: Child[];
  initial: TextWrite[];
  acknowledged: Map<number, string>;
  pending: Set<string> | null;
  dirty: boolean;
  disposed: boolean;
  mounted: boolean;
  disposal?: Promise<void>;
}
interface PreparedOwner { owner: Owner; sources: Set<string> | null; writes: TextWrite[]; props: [Child, Props][] }

/** Independent lexical owners form a tree; one family queue protects its caches. */
export function createOwnerForest(publication: ReturnType<typeof createPublicationQueue>, isClosed: () => boolean) {
  let nextId = 1;
  let placement: { family: Family; parent: Owner; node: number } | undefined;
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
  const descendants = (owner: Owner): Owner[] => {
    const result: Owner[] = [];
    const pending = [owner];
    while (pending.length) {
      const current = pending.pop()!;
      result.push(current);
      for (let i = current.children.length - 1; i >= 0; i--) pending.push(current.children[i]!.owner);
    }
    return result;
  };
  const restore = (prepared: readonly PreparedOwner[]): void => {
    for (const item of prepared) invalidate(item.owner, item.sources === null ? null : [...item.sources]);
  };
  const prepare = (family: Family): PreparedPublication => {
    const prepared: PreparedOwner[] = [];
    try {
      for (const owner of descendants(family.root!)) {
        if (owner.disposed || !owner.dirty) continue;
        const sources = owner.pending;
        const writes: TextWrite[] = [];
        for (const binding of owner.bindings) {
          if (!affected(binding.sources, sources)) continue;
          const value = textValue(binding.read());
          if (owner.acknowledged.get(binding.slot) !== value) writes.push({ slot: binding.slot, value });
        }
        const props: [Child, Props][] = [];
        for (const child of owner.children) {
          if (child.owner.disposed || !affected(child.binding.sources, sources)) continue;
          const next = propValues(child.binding.read());
          if (sameProps(child.props, next)) continue;
          invalidate(child.owner, null);
          child.owner.receive?.(next);
          props.push([child, next]);
        }
        owner.dirty = false;
        owner.pending = new Set();
        prepared.push({ owner, sources, writes, props });
      }
    } catch (error) { restore(prepared); throw error; }
    return {
      operations: prepared.flatMap(item => item.writes.length ? [{ kind: 'update' as const, handle: item.owner.instance.handle, values: item.writes }] : []),
      accept() {
        for (const item of prepared) {
          for (const write of item.writes) item.owner.acknowledged.set(write.slot, write.value);
          for (const [child, props] of item.props) child.props = props;
        }
      },
      reject() { restore(prepared); },
    };
  };
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
    const members = owner === owner.family.root && owner.family.failed ? owner.family.members : descendants(owner);
    for (const member of members) member.disposed = true;
    const retire = (): void => {
      for (const member of members) { member.mounted = false; owners.delete(member.instance); handles.delete(member.instance.handle.id); }
      const retired = new Set(members);
      owner.family.members = owner.family.members.filter(member => !retired.has(member));
      if (owner.parent) owner.parent.children = owner.parent.children.filter(child => child.owner !== owner);
      for (const member of members) {
        member.children = []; member.parent = undefined;
        member.bindings = []; member.handlers = []; member.receive = undefined;
        member.initial = []; member.acknowledged.clear(); member.pending = new Set(); member.dirty = false;
      }
      if (!owner.family.members.length) owner.family.root = undefined;
    };
    const task = owner.family.work.then(async () => {
      try { await owner.family.ready; } catch { retire(); return; }
      if (owner.mounted) await publication.publish(() => ({
        operation: { kind: 'dispose', handle: owner.instance.handle }, accept: retire, reject() {},
      }));
      else retire();
    });
    owner.family.work = task.catch(() => {});
    owner.disposal = task.finally(() => { owner.disposal = undefined; });
    return owner.disposal;
  };
  const family = (): Family => {
    const group: Family = { members: [], installs: [], ready: Promise.resolve(), work: Promise.resolve(), failed: false };
    group.ready = Promise.resolve().then(async () => {
      await Promise.all(group.installs);
      if (group.failed) throw group.error;
      await publication.publish(() => {
        const live = group.members.filter(owner => !owner.disposed);
        const operations: SceneOperation[] = live.map(owner => ({ kind: 'mount', handle: owner.instance.handle,
          template: owner.template.id, values: owner.initial, ...(owner.attachment ? { attach_to: owner.attachment } : {}) }));
        return { operations, accept() {
          for (const owner of live) { owner.mounted = true; for (const write of owner.initial) owner.acknowledged.set(write.slot, write.value); }
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
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.template.id === template.id) throw new Error('Recursive desktop component attachment is not implemented');
      }
      const initial = bindings.map(binding => ({ slot: binding.slot, value: textValue(binding.read()) }));
      const group = placement?.family ?? family();
      const attachment = placement ? { handle: placement.parent.instance.handle, node: placement.node } : undefined;
      const handle = Object.freeze({ id: nextId++, generation: 1 });
      const owner: Owner = { instance: undefined!, family: group, parent, attachment, template, bindings, handlers,
        receive: options.receiveProps, initial, children: [], acknowledged: new Map(), pending: new Set(), dirty: false, disposed: false, mounted: false };
      const instance: SceneInstance = {
        handle, ready: group.ready,
        get mounted() { return owner.mounted; },
        flush() { return flush(owner); },
        async dispatch(event, payload) {
          await group.ready;
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
      group.installs.push(install(template));
      const regions = new Set<number>();
      try {
        for (const binding of options.children ?? []) {
          if (template.nodes[binding.node]?.kind !== 'region' || regions.has(binding.node)) throw new Error('Invalid or duplicate desktop component region');
          regions.add(binding.node);
          const props = propValues(binding.read());
          const previous = placement;
          placement = { family: group, parent: owner, node: binding.node };
          let child: SceneInstance;
          try { child = binding.component(props); } finally { placement = previous; }
          const record = owners.get(child!);
          if (!record || record.parent !== owner || record.attachment?.node !== binding.node || group.members.filter(member => member.parent === owner && member.attachment?.node === binding.node).length !== 1) {
            throw new Error('Desktop child factory must return one compiled component owner');
          }
          owner.children.push({ binding, owner: record, props });
        }
      } catch (error) { group.failed = true; group.error = error; throw error; }
      return instance;
    },
  };
}

function affected(dependencies: readonly string[] | null, sources: Set<string> | null): boolean {
  return sources === null || dependencies === null || dependencies.some(source => sources.has(source));
}
function sameProps(a: Props, b: Props): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
function propValues(value: Props): Props {
  const props = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && !['undefined', 'string', 'number', 'boolean', 'bigint'].includes(typeof item)) throw new TypeError('Desktop child props currently require primitive values');
    props[key] = item;
  }
  return props;
}
function textValue(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (!['string', 'number', 'bigint'].includes(typeof value)) throw new TypeError('Desktop text expressions currently require a primitive value');
  return String(value);
}
