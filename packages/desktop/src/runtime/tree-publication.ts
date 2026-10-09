/** Prepare an accepted tree and candidate branches before one native publication. */
import type { SceneOperation, TextWrite } from '../bridge/protocol';
import type { PreparedPublication } from './publication';
import type { Child, Family, Owner, PreparedOwner } from './ownership-model';
import type { SceneComponent } from './definitions';
import { affected, propValues, sameProps, textValue, type SceneProps as Props } from './values';
import { readRegion } from './regions';

export function createTreePreparer(hooks: {
  invalidate(owner: Owner, sources: readonly string[] | null): void;
  retire(members: readonly Owner[]): void;
  owned(owner: Owner): Owner[];
  construct(parent: Owner, node: number, component: SceneComponent, props: Props, staging: boolean): Child;
  acceptMount(owner: Owner): void;
  mountOperation(owner: Owner): SceneOperation;
}) {
  const { invalidate, retire, owned, construct, acceptMount, mountOperation } = hooks;
  const restore = (prepared: readonly PreparedOwner[]): void => {
    for (const item of prepared) invalidate(item.owner, item.sources === null ? null : [...item.sources]);
  };
  return (family: Family): PreparedPublication => {
    const prepared: PreparedOwner[] = [];
    const removed = new Set<Owner>();
    const mounted = new Set<Owner>();
    try {
      const pending = [family.root!];
      while (pending.length) {
        const owner = pending.pop()!;
        if (owner.disposed) continue;
        let children = owner.children;
        if (!owner.mounted && !owner.dirty) {
          mounted.add(owner);
          pending.push(...children.map(child => child.owner).reverse()); continue;
        }
        if (owner.mounted && !owner.dirty) {
          pending.push(...children.map(child => child.owner).reverse()); continue;
        }
        const sources = owner.pending;
        const writes: TextWrite[] = [];
        for (const binding of owner.bindings) {
          if (owner.mounted && !affected(binding.sources, sources)) continue;
          const value = textValue(binding.read());
          if (owner.acknowledged.get(binding.slot) !== value) writes.push({ slot: binding.slot, value });
        }
        const props: [Child, Props][] = [];
        for (const child of owner.children) {
          if (!child.binding || child.owner.disposed || !affected(child.binding.sources, sources)) continue;
          const next = propValues(child.binding.read());
          if (sameProps(child.props, next)) continue;
          invalidate(child.owner, null);
          child.owner.receive?.(next);
          props.push([child, next]);
        }
        const changes: PreparedOwner['regions'] = [];
        for (const region of owner.regions) {
          if (owner.mounted && !affected(region.binding.sources, sources)) continue;
          const next = readRegion(region.binding);
          let child: Child | undefined;
          if (next.branch === region.branch && !region.child?.owner.disposed) {
            if (region.candidate) retire(owned(region.candidate.child.owner));
            child = region.child;
          } else {
            if (region.candidate && region.candidate.branch !== next.branch) retire(owned(region.candidate.child.owner));
            if (next.component) {
              if (!region.candidate) region.candidate = { branch: next.branch, child: construct(owner, region.binding.node, next.component, next.props, true) };
              child = region.candidate.child;
            }
            if (region.child) removed.add(region.child.owner);
          }
          if (child && !sameProps(child.props, next.props)) {
            invalidate(child.owner, null); child.owner.receive?.(next.props); props.push([child, next.props]);
          }
          changes.push({ region, branch: next.branch, child });
          children = children.filter(link => link.node !== region.binding.node);
          if (child) children = [...children, child];
        }
        if (!owner.mounted) {
          mounted.add(owner);
          owner.initial = writes;
        }
        owner.dirty = false;
        owner.pending = new Set();
        prepared.push({ owner, sources, writes, props, regions: changes });
        children = [...children].sort((a,b) => a.node-b.node);
        pending.push(...children.map(child => child.owner).reverse());
      }
    } catch (error) { restore(prepared); throw error; }
    return {
      operations: [
        ...prepared.flatMap(item => !mounted.has(item.owner) && item.writes.length ? [{ kind: 'update' as const, handle: item.owner.instance.handle, values: item.writes }] : []),
        ...[...removed].map(owner => ({ kind: 'dispose' as const, handle: owner.instance.handle })),
        ...[...mounted].map(mountOperation),
      ],
      accept() {
        for (const owner of removed) retire(owned(owner));
        for (const owner of mounted) acceptMount(owner);
        for (const item of prepared) {
          for (const write of item.writes) item.owner.acknowledged.set(write.slot, write.value);
          for (const [child, props] of item.props) child.props = props;
          for (const change of item.regions) {
            change.region.branch = change.branch; change.region.child = change.child; change.region.candidate = undefined;
            item.owner.children = item.owner.children.filter(child => child.node !== change.region.binding.node);
            if (change.child) item.owner.children.push(change.child);
          }
          item.owner.children.sort((a,b) => a.node-b.node);
        }
      },
      reject() { restore(prepared); },
    };
  };
}
