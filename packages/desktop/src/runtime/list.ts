/** Accepted native row ranges; source reads and scheduling belong to core. */
import {
  cleanup,
  encodeListKey,
  invalidateEntity,
  registerEntity,
  registerProps,
  unregisterSubtree,
} from '@memoized-dom/runtime/core';

import {
  HostError,
  type Acceptance,
  type Operation,
  type Owner,
  type Publication,
  type SourceReference,
  type Template,
} from '../host/protocol';
import type { NativeFrame, NativePresentation } from './view';

/** A generated row closes over item/index bindings instead of copying state. */
export interface NativeListEntry<T> {
  readonly view: NativePresentation;
  /** Rebind the row before its existing core entity renders. */
  readonly update: (item: T, index: number) => void;
}

interface Row<T> {
  readonly key: unknown;
  readonly owner: Owner;
  readonly entry: NativeListEntry<T>;
}

interface Selection<T> {
  readonly key: unknown;
  readonly item: T;
  readonly index: number;
}

/**
 * One semantic list owner retains keyed native ranges. A structural publication
 * stages new rows outside core and freezes outgoing rows until acceptance. It
 * neither resolves source accesses nor maintains a separate reactive graph.
 */
export class NativeList<T> implements NativePresentation {
  readonly ownerId: string;

  private phase: 'prepared' | 'publishing' | 'active' | 'disposed' = 'prepared';
  private coreAttached = false;
  private rows = new Map<unknown, Row<T>>();
  private staged: Row<T>[] = [];
  private generation: number;
  private syntheticKey = 0;
  private pending?: Promise<Acceptance>;
  private needsUpdate = false;
  private updatesSuspended = false;
  private deferredProps?: unknown[];

  constructor(
    private readonly frame: NativeFrame,
    private readonly read: () => readonly T[],
    private readonly create: (
      frame: NativeFrame, item: T, index: number,
    ) => NativeListEntry<T>,
    private readonly key: (item: T, index: number) => unknown = item => item,
  ) {
    this.ownerId = frame.entityId ?? frame.owner.id;
    this.generation = frame.owner.generation;

    if (!frame.deferCore) {
      this.attachOwnCore();
    }

    try {
      // Validate all keys before running any row factory.
      for (const selected of this.select()) {
        const row = this.createRow(selected, frame.deferCore === true);
        this.rows.set(selected.key, row);
      }
    } catch (error) {
      if (this.coreAttached) {
        this.retireCore();
      } else {
        this.discardStaged();
      }

      throw error;
    }
  }

  get initialPublication(): Publication {
    if (this.phase === 'prepared') {
      this.phase = 'publishing';
    }

    return combinePublications([...this.rows.values()].map(row => row.entry.view.initialPublication));
  }

  bindProps(box: unknown[]): void {
    if (this.deferredProps !== undefined) {
      throw new HostError('duplicateProps', 'Native list props are already bound');
    }

    if (this.coreAttached) {
      registerProps(this.ownerId, box);
    } else {
      this.deferredProps = box;
    }
  }

  retirementPublication(): Publication {
    return combinePublications([...this.rows.values()].map(row => row.entry.view.retirementPublication()));
  }

  acceptInitial(): void {
    if (this.phase !== 'publishing') {
      throw new HostError('invalidList', 'Native list is not publishing');
    }

    for (const row of this.rows.values()) {
      row.entry.view.acceptInitial();
    }

    this.phase = 'active';
  }

  activateUpdates(): void {
    for (const row of this.rows.values()) {
      row.entry.view.activateUpdates();
    }

    this.resumeDeferred();
  }

  updateFromOwner(): void {
    this.render();
  }

  suspendUpdates(): void {
    this.updatesSuspended = true;

    for (const row of this.rows.values()) {
      row.entry.view.suspendUpdates();
    }
  }

  resumeUpdates(): void {
    this.updatesSuspended = false;

    // An ancestor may resume while our own structural transaction is pending.
    if (this.pending === undefined) {
      for (const row of this.rows.values()) {
        row.entry.view.resumeUpdates();
      }
    }

    this.resumeDeferred();
  }

  dispatch(source: number | SourceReference, name: string, event: unknown): unknown {
    return this.sourceView(source).dispatch(source, name, event);
  }

  eventTarget(source: number | SourceReference): object {
    return this.sourceView(source).eventTarget(source);
  }

  matchesSource(source: SourceReference): boolean {
    return this.phase === 'active' && [...this.rows.values()].some(
      row => row.entry.view.matchesSource(source),
    );
  }

  async publication(): Promise<Acceptance | undefined> {
    const structural = await (this.pending ?? Promise.resolve(undefined));
    const accepted = await Promise.all([
      ...this.rows.values(),
    ].map(row => row.entry.view.publication()));

    return [structural, ...accepted].reduce<Acceptance | undefined>((latest, next) => {
      return next !== undefined && (latest === undefined || next.sequence > latest.sequence)
        ? next
        : latest;
    }, undefined);
  }

  attachCore(): void {
    if (this.phase === 'disposed') {
      throw new HostError('disposedList', 'A disposed native list cannot be attached');
    }

    if (!this.coreAttached) {
      this.attachOwnCore();
    }

    for (const row of this.rows.values()) {
      row.entry.view.attachCore();
    }
  }

  discardStaged(): void {
    if (this.coreAttached) {
      throw new HostError('attachedList', 'An attached native list requires core-owned disposal');
    }

    for (const row of this.rows.values()) {
      row.entry.view.discardStaged();
    }

    this.rows.clear();
    this.deferredProps = undefined;
    this.dispose();
  }

  retireCore(): void {
    unregisterSubtree(this.ownerId);
  }

  dispose(): void {
    if (this.phase === 'disposed') {
      return;
    }

    this.phase = 'disposed';

    for (const row of this.rows.values()) {
      row.entry.view.dispose();
    }

    this.discardCandidates();
    this.rows.clear();
    this.pending = undefined;
    this.deferredProps = undefined;
  }

  private render(): void {
    if (this.phase === 'disposed') {
      return;
    }

    if (this.updatesSuspended || this.phase !== 'active' || this.pending !== undefined) {
      this.needsUpdate = true;
      return;
    }

    const selection = this.select();
    const next = new Map<unknown, Row<T>>();

    try {
      for (const selected of selection) {
        let row = this.rows.get(selected.key);

        if (row === undefined) {
          row = this.createRow(selected, true);
          this.staged.push(row);
        }

        next.set(selected.key, row);
      }
    } catch (error) {
      this.discardCandidates();
      throw error;
    }

    const removed = [...this.rows.values()].filter(row => !next.has(row.key));
    let added: Publication;

    try {
      added = combinePublications(this.staged.map(row => row.entry.view.initialPublication));
    } catch (error) {
      this.discardCandidates();
      throw error;
    }

    const operations: Operation[] = [
      ...removed.flatMap(row => row.entry.view.retirementPublication().operations),
      ...added.operations,
      ...placementOperations(
        [...this.rows.values()].filter(row => next.has(row.key)).concat(this.staged),
        [...next.values()],
      ),
    ];

    if (operations.length === 0) {
      this.refreshRows(next, selection);
      return;
    }

    const previous = this.rows;

    for (const row of previous.values()) {
      row.entry.view.suspendUpdates();
    }

    const publication = this.frame.application.publish({ templates: added.templates, operations }, () => {
      // Ancestor retirement can dispose this controller while acknowledgment
      // is in flight. Its staged candidates must never attach afterward.
      if (this.phase === 'disposed') {
        return;
      }

      for (const row of removed) {
        row.entry.view.retireCore();
      }

      // Shared cleanup is authored code and may retire the containing owner.
      // Disposal has already discarded candidates; never resurrect that list.
      if (this.phase !== 'active') {
        return;
      }

      for (const row of this.staged) {
        row.entry.view.attachCore();
        row.entry.view.acceptInitial();
      }

      const created = this.staged;
      this.staged = [];
      this.rows = next;
      this.refreshRows(next, selection, previous);

      for (const row of next.values()) {
        if (!this.updatesSuspended) {
          row.entry.view.resumeUpdates();
        } else {
          row.entry.view.suspendUpdates();
        }
      }

      for (const row of created) {
        row.entry.view.activateUpdates();
      }
    });

    this.pending = publication;

    void publication.then(
      () => {
        this.pending = undefined;
        this.resumeDeferred();
      },
      error => {
        this.pending = undefined;

        if (!this.frame.application.isClosed && this.phase !== 'disposed') {
          this.frame.application.run(() => {
            this.discardCandidates();

            if (!this.updatesSuspended) {
              for (const row of previous.values()) {
                row.entry.view.resumeUpdates();
              }
            }
          });
          this.frame.reportError(error);
          this.resumeDeferred();
        }
      },
    ).catch(() => {});
  }

  private refreshRows(
    rows: Map<unknown, Row<T>>,
    selection: readonly Selection<T>[],
    retained = rows,
  ): void {
    for (const selected of selection) {
      if (retained.has(selected.key)) {
        const row = rows.get(selected.key)!;
        row.entry.update(selected.item, selected.index);
        invalidateEntity(row.entry.view.ownerId);
      }
    }
  }

  private select(): Selection<T>[] {
    const items = this.read();

    if (!Array.isArray(items)) {
      throw new HostError('invalidListSource', 'Native list source must be an array');
    }

    const selection: Selection<T>[] = [];
    const keys = new Set<unknown>();
    // Capture items before calling authored key functions: mutation during key
    // evaluation must not change the remaining input of this transaction.
    const snapshot = Array.from(items);

    for (let index = 0; index < snapshot.length; index++) {
      const item = snapshot[index]!;
      const key = this.key(item, index);

      if (keys.has(key)) {
        throw new HostError('duplicateListKey', 'Native list contains duplicate keys');
      }

      keys.add(key);
      selection.push({ key, item, index });
    }

    return selection;
  }

  private createRow(selected: Selection<T>, deferCore: boolean): Row<T> {
    const encoded = encodeListKey(selected.key) ?? `#${++this.syntheticKey}`;
    const segment = `Row[${encoded}]`;

    if (this.generation === Number.MAX_SAFE_INTEGER) {
      throw new HostError('generationExhausted', 'Native list row generation is exhausted');
    }

    // A reinserted primitive key reuses its semantic id with a fresh native
    // generation. Refused candidates consume no native lifetime, but JavaScript
    // still allocates a new generation rather than retaining a tombstone map.
    const owner = { id: `${this.frame.owner.id}/${segment}`, generation: ++this.generation };
    const entry = this.create({
      application: this.frame.application,
      owner,
      entityId: `${this.ownerId}/${segment}`,
      parent: this.ownerId,
      reportError: this.frame.reportError,
      mountTarget: this.frame.mountTarget,
      deferCore,
    }, selected.item, selected.index);

    return { key: selected.key, owner, entry };
  }

  private sourceView(source: number | SourceReference): NativePresentation {
    if (this.phase === 'active' && typeof source !== 'number') {
      for (const row of this.rows.values()) {
        if (row.entry.view.matchesSource(source)) {
          return row.entry.view;
        }
      }
    }

    throw new HostError('inactiveView', 'Native list source is not active');
  }

  private discardCandidates(): void {
    const staged = this.staged;
    this.staged = [];

    for (const row of staged) {
      row.entry.view.discardStaged();
    }
  }

  private attachOwnCore(): void {
    registerEntity({ id: this.ownerId, parent: this.frame.parent, render: () => this.render() });
    cleanup(this.ownerId, () => this.dispose());
    this.coreAttached = true;

    if (this.deferredProps !== undefined) {
      registerProps(this.ownerId, this.deferredProps);
      this.deferredProps = undefined;
    }
  }

  private resumeDeferred(): void {
    if (
      this.needsUpdate &&
      !this.updatesSuspended &&
      this.phase === 'active' &&
      !this.frame.application.isClosed
    ) {
      this.needsUpdate = false;
      this.frame.application.run(() => invalidateEntity(this.ownerId));
    }
  }
}

/** Compiler-private factory for the native list emission boundary. */
export function createList<T>(
  frame: NativeFrame,
  read: () => readonly T[],
  create: (frame: NativeFrame, item: T, index: number) => NativeListEntry<T>,
  key?: (item: T, index: number) => unknown,
): NativeList<T> {
  return new NativeList(frame, read, create, key);
}

function combinePublications(publications: readonly Publication[]): Publication {
  const templates = new Map<string, Template>();
  const operations: Operation[] = [];

  for (const publication of publications) {
    for (const template of publication.templates ?? []) {
      templates.set(template.key, template);
    }

    operations.push(...publication.operations);
  }

  return { templates: [...templates.values()], operations };
}

/**
 * Native mounts append before their common destination anchor. Work backward
 * through the desired order, moving only ranges whose next neighbor differs.
 * The temporary neighbor links keep planning linear; they are not another
 * retained scene. This makes no claim to the web reconciler's LIS optimizations.
 */
function placementOperations<T>(current: readonly Row<T>[], desired: readonly Row<T>[]): Operation[] {
  const next = new Map<Row<T>, Row<T> | undefined>();
  const previous = new Map<Row<T>, Row<T> | undefined>();
  let tail = current.at(-1);

  for (let index = 0; index < current.length; index++) {
    next.set(current[index]!, current[index + 1]);
    previous.set(current[index]!, current[index - 1]);
  }

  const operations: Operation[] = [];
  let cursor: Row<T> | undefined;

  for (let index = desired.length - 1; index >= 0; index--) {
    const row = desired[index]!;

    if (next.get(row) !== cursor) {
      operations.push(cursor === undefined
        ? { op: 'moveToEnd', owner: row.owner }
        : { op: 'moveBefore', owner: row.owner, before: cursor.owner });

      const before = previous.get(row);
      const after = next.get(row);

      if (before !== undefined) next.set(before, after);
      if (after !== undefined) previous.set(after, before);
      if (tail === row) tail = before;

      const insertion = cursor === undefined ? tail : previous.get(cursor);
      if (insertion !== undefined) next.set(insertion, row);
      if (cursor !== undefined) previous.set(cursor, row);
      previous.set(row, insertion);
      next.set(row, cursor);
      if (cursor === undefined) tail = row;
    }

    cursor = row;
  }

  return operations;
}
