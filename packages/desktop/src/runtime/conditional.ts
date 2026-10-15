/** Accepted conditional replacement over the shared core entity graph. */
import {
  cleanup,
  invalidateEntity,
  registerEntity,
  registerProps,
  unregisterSubtree,
} from '@memoized-dom/runtime/core';

import {
  HostError,
  type Acceptance,
  type Owner,
  type Publication,
  type SourceReference,
} from '../host/protocol';

import type {
  NativeFrame,
  NativePresentation,
} from './view';

export type NativeBranchFactory = (
  frame: NativeFrame,
) => NativePresentation;

/** A slot resolves its current factory without retaining every past factory. */
type NativeBranchSource =
  | readonly (NativeBranchFactory | null)[]
  | ((index: number) => NativeBranchFactory | null | undefined);

/**
 * A stable semantic owner selects one native branch range at a time. The old
 * branch remains both native and core-live until the replacement transaction
 * is accepted.
 */
export class NativeConditional implements NativePresentation {
  readonly ownerId: string;

  private phase: 'prepared' | 'publishing' | 'active' | 'disposed' = 'prepared';
  private coreAttached = false;
  private current: NativePresentation | null = null;
  private currentIndex: number;
  private currentOwner: Owner | null = null;
  private generation: number;
  private pending?: Promise<Acceptance>;
  private needsUpdate = false;
  private updatesSuspended = false;
  private deferredProps?: unknown[];

  constructor(
    private readonly frame: NativeFrame,
    private readonly pick: () => number,
    private readonly branches: NativeBranchSource,
  ) {
    this.ownerId = frame.entityId ?? frame.owner.id;
    this.generation = frame.owner.generation;

    if (!frame.deferCore) {
      this.attachOwnCore();
    }

    this.currentIndex = this.readIndex();
    this.current = this.createBranch(
      this.currentIndex,
      this.generation,
      frame.deferCore === true,
    );

    if (this.current !== null) {
      this.currentOwner = this.branchOwner(this.generation);
    }
  }

  get initialPublication(): Publication {
    if (this.phase === 'prepared') {
      this.phase = 'publishing';
    }

    return this.current?.initialPublication ?? { operations: [] };
  }

  bindProps(box: unknown[]): void {
    if (this.deferredProps !== undefined) {
      throw new HostError('duplicateProps', 'Native conditional props are already bound');
    }

    if (this.coreAttached) {
      registerProps(this.ownerId, box);
      return;
    }

    this.deferredProps = box;
  }

  retirementPublication(): Publication {
    return {
      operations: this.currentOwner === null
        ? []
        : [{ op: 'retire', owner: this.currentOwner }],
    };
  }

  acceptInitial(): void {
    if (this.phase !== 'publishing') {
      throw new HostError('invalidConditional', 'Native conditional is not publishing');
    }

    this.current?.acceptInitial();
    this.phase = 'active';
  }

  activateUpdates(): void {
    this.current?.activateUpdates();

    if (this.needsUpdate) {
      this.needsUpdate = false;
      invalidateEntity(this.ownerId);
    }
  }

  updateFromOwner(): void {
    this.render();
  }

  suspendUpdates(): void {
    this.updatesSuspended = true;
    this.current?.suspendUpdates();
  }

  resumeUpdates(): void {
    this.updatesSuspended = false;
    this.current?.resumeUpdates();

    if (this.needsUpdate && this.phase === 'active') {
      this.needsUpdate = false;
      invalidateEntity(this.ownerId);
    }
  }

  dispatch(source: number | SourceReference, name: string, event: unknown): unknown {
    if (typeof source === 'number' || !this.current?.matchesSource(source)) {
      throw new HostError('inactiveView', 'Native conditional source is not active');
    }

    return this.current.dispatch(source, name, event);
  }

  matchesSource(source: SourceReference): boolean {
    return this.phase === 'active' && this.current?.matchesSource(source) === true;
  }

  eventTarget(source: number | SourceReference): object {
    if (typeof source === 'number' || !this.current?.matchesSource(source)) {
      throw new HostError('unknownEventSource', 'Native conditional source is unknown');
    }

    return this.current.eventTarget(source);
  }

  async publication(): Promise<Acceptance | undefined> {
    const structural = await (this.pending ?? Promise.resolve(undefined));
    const branch = await (this.current?.publication() ?? Promise.resolve(undefined));

    if (structural === undefined) {
      return branch;
    }

    if (branch === undefined || structural.sequence > branch.sequence) {
      return structural;
    }

    return branch;
  }

  attachCore(): void {
    if (this.phase === 'disposed') {
      throw new HostError('disposedConditional', 'A disposed conditional cannot be attached');
    }

    if (!this.coreAttached) {
      this.attachOwnCore();
    }

    this.current?.attachCore();
  }

  discardStaged(): void {
    if (this.coreAttached) {
      throw new HostError(
        'attachedConditional',
        'An attached conditional requires core-owned disposal',
      );
    }

    this.current?.discardStaged();
    this.deferredProps = undefined;
    this.current = null;
    this.currentOwner = null;
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
    this.frame.application.releaseDeferredPresentation(this);
    this.current?.dispose();
    this.current = null;
    this.currentOwner = null;
    this.pending = undefined;
  }

  private render(): void {
    if (this.phase === 'disposed') {
      return;
    }

    if (
      this.updatesSuspended ||
      this.phase !== 'active' ||
      this.pending !== undefined
    ) {
      this.needsUpdate = true;
      return;
    }

    if (this.frame.application.deferPresentation(this, () => this.resumeDeferred())) {
      this.needsUpdate = true;
      return;
    }

    const nextIndex = this.readIndex();

    if (nextIndex === this.currentIndex) {
      this.current?.updateFromOwner();
      return;
    }

    const nextGeneration = this.generation + 1;
    const next = this.createBranch(nextIndex, nextGeneration, true);
    const nextPublication = next?.initialPublication ?? { operations: [] };
    const operations = [
      ...(this.currentOwner === null
        ? []
        : [{ op: 'retire' as const, owner: this.currentOwner }]),
      ...nextPublication.operations,
    ];

    if (operations.length === 0) {
      this.currentIndex = nextIndex;
      return;
    }

    const previous = this.current;
    const nextOwner = next === null
      ? null
      : this.branchOwner(nextGeneration);
    previous?.suspendUpdates();

    const publication = this.frame.application.publish({
      templates: nextPublication.templates,
      operations,
    }, () => {
      previous?.retireCore();
      next?.attachCore();
      next?.acceptInitial();

      this.current = next;
      this.currentIndex = nextIndex;
      this.currentOwner = nextOwner;
      this.generation = nextGeneration;

      next?.activateUpdates();
    });

    this.pending = publication;

    void publication.then(
      () => {
        this.pending = undefined;
        this.resumeDeferred();
      },
      (error) => {
        this.pending = undefined;

        if (!this.frame.application.isClosed) {
          this.frame.application.run(() => {
            next?.discardStaged();
            previous?.resumeUpdates();
          });
          this.frame.reportError(error);
          this.resumeDeferred();
        }
      },
    ).catch(() => {});
  }

  private createBranch(
    index: number,
    generation: number,
    deferCore: boolean,
  ): NativePresentation | null {
    const factory = typeof this.branches === 'function'
      ? this.branches(index)
      : this.branches[index];

    if (factory === null) {
      return null;
    }

    if (factory === undefined) {
      throw new HostError('invalidBranch', 'Native conditional selected an unknown branch');
    }

    return factory({
      application: this.frame.application,
      owner: this.branchOwner(generation),
      entityId: this.ownerId,
      parent: this.ownerId,
      reportError: this.frame.reportError,
      mountTarget: this.frame.mountTarget,
      registerCore: false,
      deferCore,
    });
  }

  private branchOwner(generation: number): Owner {
    return {
      id: `${this.frame.owner.id}/$content`,
      generation,
    };
  }

  private readIndex(): number {
    const index = this.pick();

    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      (typeof this.branches !== 'function' && index >= this.branches.length)
    ) {
      throw new HostError('invalidBranch', 'Native conditional returned an invalid branch index');
    }

    return index;
  }

  private attachOwnCore(): void {
    registerEntity({
      id: this.ownerId,
      parent: this.frame.parent,
      render: () => this.render(),
    });

    cleanup(this.ownerId, () => this.dispose());
    this.coreAttached = true;

    if (this.deferredProps !== undefined) {
      registerProps(this.ownerId, this.deferredProps);
      this.deferredProps = undefined;
    }
  }

  private resumeDeferred(): void {
    if (this.needsUpdate && this.phase === 'active' && !this.frame.application.isClosed) {
      this.needsUpdate = false;
      this.frame.application.run(() => invalidateEntity(this.ownerId));
    }
  }
}

export function createConditional(
  frame: NativeFrame,
  pick: () => number,
  branches: readonly (NativeBranchFactory | null)[],
): NativeConditional {
  return new NativeConditional(frame, pick, branches);
}
