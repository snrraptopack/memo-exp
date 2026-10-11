/** Prepare an accepted tree and candidate branches before one native publication. */
import type { SceneOperation, TextWrite } from '../bridge/protocol';
import type { PreparedPublication } from './publication';
import type { Child, Family, Owner, PreparedOwner } from './ownership-model';
import type { SceneComponent } from './definitions';
import { affected, sameProps, textValue, type SceneProps as Props } from './values';
import { readRegion } from './regions';
import { readList } from './lists';

export function createTreePreparer(hooks: {
  invalidate(owner: Owner, sources: readonly string[] | null): void;
  retire(members: readonly Owner[]): void;
  owned(roots: Owner | readonly Owner[]): Owner[];
  construct(
    parent: Owner,
    node: number,
    component: SceneComponent,
    props: Props,
    staging: boolean,
  ): Child;
  acceptMount(owner: Owner): void;
  mountOperation(owner: Owner): SceneOperation;
}) {
  const { invalidate, retire, owned, construct, acceptMount, mountOperation } = hooks;
  const restore = (prepared: readonly PreparedOwner[]): void => {
    for (const item of prepared)
      invalidate(item.owner, item.sources === null ? null : [...item.sources]);
  };
  return (family: Family): PreparedPublication => {
    const prepared: PreparedOwner[] = [];
    const removed = new Set<Owner>();
    const mounted = new Set<Owner>();
    const received = new Map<Child, Props>();
    let speculative = true;
    const receive = (child: Child, next: Props): void => {
      if (!received.has(child)) received.set(child, child.props);
      invalidate(child.owner, null);
      child.owner.receive?.(next);
    };
    const restoreBindings = (): void => {
      if (!speculative) return;
      speculative = false;
      for (const [child, previous] of received) {
        try {
          child.owner.receive?.(previous);
          child.owner.prepare?.(null);
        } catch (error) {
          family.failed = true;
          family.error = error;
        }
      }
    };
    const rollback = (): void => {
      restoreBindings();
      restore(prepared);
    };
    try {
      const pending = [family.root!];
      while (pending.length) {
        const owner = pending.pop()!;
        if (owner.disposed) continue;
        let children = owner.children;
        if (!owner.mounted && !owner.dirty) {
          mounted.add(owner);
          pending.push(...children.map((child) => child.owner).reverse());
          continue;
        }
        if (owner.mounted && !owner.dirty) {
          pending.push(...children.map((child) => child.owner).reverse());
          continue;
        }
        const sources = owner.pending;
        owner.prepare?.(sources);
        const writes: TextWrite[] = [];
        for (const binding of owner.bindings) {
          if (owner.mounted && !affected(binding.sources, sources)) continue;
          const value = textValue(binding.read());
          if (owner.acknowledged.get(binding.slot) !== value)
            writes.push({ slot: binding.slot, value });
        }
        const props: [Child, Props][] = [];
        for (const child of owner.children) {
          if (!child.binding || child.owner.disposed || !affected(child.binding.sources, sources))
            continue;
          const next = owner.readProps(child.binding.read());
          if (sameProps(child.props, next)) continue;
          receive(child, next);
          props.push([child, next]);
        }
        const changes: PreparedOwner['regions'] = [];
        for (const region of owner.regions) {
          if (owner.mounted && !affected(region.binding.sources, sources)) continue;
          const next = readRegion(region.binding, owner.readProps);
          let child: Child | undefined;
          if (next.branch === region.branch && !region.child?.owner.disposed) {
            if (region.candidate) retire(owned(region.candidate.child.owner));
            child = region.child;
          } else {
            if (region.candidate && region.candidate.branch !== next.branch)
              retire(owned(region.candidate.child.owner));
            if (next.component) {
              if (!region.candidate)
                region.candidate = {
                  branch: next.branch,
                  child: construct(owner, region.binding.node, next.component, next.props, true),
                };
              child = region.candidate.child;
            }
            if (region.child) removed.add(region.child.owner);
          }
          if (child && !sameProps(child.props, next.props)) {
            receive(child, next.props);
            props.push([child, next.props]);
          }
          changes.push({ region, branch: next.branch, child });
          children = children.filter((link) => link.node !== region.binding.node);
          if (child) children = [...children, child];
        }
        const lists: PreparedOwner['lists'] = [];
        for (const list of owner.lists) {
          if (owner.mounted && !affected(list.binding.sources, sources)) continue;
          const values = readList(list.binding, owner.readProps);
          const wanted = new Set(values.map((value) => value.key));
          const canceled = [...list.candidates]
            .filter(([key]) => !wanted.has(key))
            .map(([, row]) => row.owner);
          if (canceled.length) retire(owned(canceled));
          const accepted = new Map(
            list.rows.filter((row) => !row.owner.disposed).map((row) => [row.key, row]),
          );
          const rows = values.map((value) => {
            let row = accepted.get(value.key) ?? list.candidates.get(value.key);
            if (!row) {
              row = {
                ...construct(owner, list.binding.node, list.binding.component, value.props, true),
                key: value.key,
              };
              list.candidates.set(value.key, row);
            }
            if (!sameProps(row.props, value.props)) {
              receive(row, value.props);
              props.push([row, value.props]);
            }
            return row;
          });
          const retained = new Set(rows.map((row) => row.owner));
          for (const row of list.rows) if (!retained.has(row.owner)) removed.add(row.owner);
          const changed =
            rows.length !== list.rows.length || rows.some((row, index) => row !== list.rows[index]);
          lists.push({ list, rows, changed });
          children = [...children.filter((child) => child.node !== list.binding.node), ...rows];
        }
        if (!owner.mounted) {
          mounted.add(owner);
          owner.initial = writes;
        }
        owner.dirty = false;
        owner.pending = new Set();
        prepared.push({ owner, sources, writes, props, regions: changes, lists });
        children = [...children].sort((a, b) => a.node - b.node);
        pending.push(...children.map((child) => child.owner).reverse());
      }
      restoreBindings();
      if (family.failed) throw family.error;
    } catch (error) {
      rollback();
      throw error;
    }
    const preparedByOwner = new Map(prepared.map((item) => [item.owner, item]));
    return {
      operations: [
        ...prepared.flatMap((item) =>
          !mounted.has(item.owner) && item.writes.length
            ? [{ kind: 'update' as const, handle: item.owner.instance.handle, values: item.writes }]
            : [],
        ),
        ...[...removed]
          .filter((owner) => owner.mounted)
          .map((owner) => ({ kind: 'dispose' as const, handle: owner.instance.handle })),
        ...[...mounted].map(mountOperation),
        ...[...mounted].flatMap((owner) =>
          owner.lists.map((list) => ({
            kind: 'order' as const,
            handle: owner.instance.handle,
            node: list.binding.node,
            children: (
              preparedByOwner.get(owner)?.lists.find((change) => change.list === list)?.rows ??
              list.rows
            ).map((row) => row.owner.instance.handle),
          })),
        ),
        ...prepared.flatMap((item) =>
          mounted.has(item.owner)
            ? []
            : item.lists
                .filter((change) => change.changed)
                .map((change) => ({
                  kind: 'order' as const,
                  handle: item.owner.instance.handle,
                  node: change.list.binding.node,
                  children: change.rows.map((row) => row.owner.instance.handle),
                })),
        ),
      ],
      accept() {
        if (removed.size) retire(owned([...removed]));
        for (const owner of mounted) acceptMount(owner);
        for (const item of prepared) {
          for (const write of item.writes) item.owner.acknowledged.set(write.slot, write.value);
          for (const [child, props] of item.props) {
            child.owner.receive?.(props);
            child.owner.prepare?.(null);
            child.props = props;
          }
          for (const change of item.regions) {
            change.region.branch = change.branch;
            change.region.child = change.child;
            change.region.candidate = undefined;
            item.owner.children = item.owner.children.filter(
              (child) => child.node !== change.region.binding.node,
            );
            if (change.child) item.owner.children.push(change.child);
          }
          for (const change of item.lists) {
            change.list.rows = change.rows;
            change.list.candidates.clear();
            item.owner.children = [
              ...item.owner.children.filter((child) => child.node !== change.list.binding.node),
              ...change.rows,
            ];
          }
          item.owner.children.sort((a, b) => a.node - b.node);
          item.owner.effectInvalidations?.(item.sources);
        }
      },
      reject() {
        rollback();
      },
    };
  };
}
