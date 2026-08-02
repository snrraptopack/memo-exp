/** Dev-only ownership and replacement for compiler-emitted component roots. */
import {
  markDirtySubtree,
  onEntityDispose,
  registeredIds,
  unregisterSubtree,
  type EntityId,
} from './kernel';
import { uninstallAccessTable } from './access';
import { rootNodes } from './jsx-dom';

export type HotComponentFactory = (
  id: string,
  parent: string | null,
  props?: unknown[],
) => Node;

interface HotComponentRecord {
  factory: HotComponentFactory;
  id: EntityId;
  parent: EntityId | null;
  nodes: Node[];
  props: unknown[] | null;
}

export type HotComponentUpdate = readonly [
  previous: HotComponentFactory,
  next: HotComponentFactory | undefined,
  lightweight: boolean,
];

const recordsByFactory = new Map<
  HotComponentFactory,
  Set<HotComponentRecord>
>();
const recordsById = new Map<EntityId, HotComponentRecord>();
let disposeHookInstalled = false;

function forget(record: HotComponentRecord): void {
  recordsById.delete(record.id);
  const records = recordsByFactory.get(record.factory);
  records?.delete(record);
  if (records?.size === 0) recordsByFactory.delete(record.factory);
}

function ensureDisposeHook(): void {
  if (disposeHookInstalled) return;
  disposeHookInstalled = true;
  onEntityDispose((id) => {
    const record = recordsById.get(id);
    if (record !== undefined) forget(record);
  });
}

export function registerHotComponent(
  factory: HotComponentFactory,
  id: EntityId,
  parent: EntityId | null,
  nodes: Node[],
  props: unknown[] | null,
): void {
  ensureDisposeHook();
  const previous = recordsById.get(id);
  if (previous !== undefined) forget(previous);
  const record = { factory, id, parent, nodes, props };
  recordsById.set(id, record);
  const records = recordsByFactory.get(factory) ?? new Set();
  records.add(record);
  recordsByFactory.set(factory, records);
}

function replaceRecord(
  record: HotComponentRecord,
  next: HotComponentFactory,
): void {
  if (recordsById.get(record.id) !== record) return;
  const first = record.nodes.find((node) => node.parentNode !== null);
  const parent = first?.parentNode;
  const document = first?.ownerDocument;
  const anchor = document?.createComment('memoized-dom-hmr');
  if (
    first !== undefined &&
    parent !== undefined &&
    parent !== null &&
    anchor !== undefined
  ) {
    parent.insertBefore(anchor, first);
  }

  unregisterSubtree(record.id);
  for (const node of record.nodes) node.parentNode?.removeChild(node);
  const root =
    record.props === null
      ? next(record.id, record.parent)
      : next(record.id, record.parent, record.props);
  const nextNodes = rootNodes(root);
  if (anchor?.parentNode !== null && anchor?.parentNode !== undefined) {
    const anchorParent = anchor.parentNode;
    for (const node of nextNodes) anchorParent.insertBefore(node, anchor);
    anchorParent.removeChild(anchor);
  }
}

function replaceFactory(
  previous: HotComponentFactory,
  next: HotComponentFactory,
): number {
  const records = [...(recordsByFactory.get(previous) ?? [])];
  for (const record of records) replaceRecord(record, next);
  return records.length;
}

function remountRoots(): void {
  const roots = [...recordsById.values()].filter(
    (record) => record.parent === null,
  );
  for (const root of roots) replaceRecord(root, root.factory);
}

/** Apply one accepted Vite module update to its live component instances. */
export function applyHotUpdate(
  updates: readonly HotComponentUpdate[],
  rootId: EntityId,
): void {
  if (
    updates.some(([, next, lightweight]) => next === undefined || lightweight)
  ) {
    remountRoots();
    return;
  }
  let replacements = 0;
  for (const [previous, next] of updates) {
    if (next !== undefined) replacements += replaceFactory(previous, next);
  }
  if (replacements === 0) markDirtySubtree(rootId);
}

/** Remove stale module-owned singleton entities and analysis before reevaluation. */
export function disposeHotModule(moduleId: string, rootId: EntityId): void {
  uninstallAccessTable(moduleId);
  const encoded = encodeURIComponent(moduleId);
  const computed = `${rootId}/$computed/${encoded}#`;
  const effects = `${rootId}/$module-effects/${encoded}/`;
  for (const id of [...registeredIds()]) {
    if (id.startsWith(computed) || id.startsWith(effects)) {
      unregisterSubtree(id);
    }
  }
}
