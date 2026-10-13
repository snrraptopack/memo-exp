import {
  cleanup,
  createApplicationRuntime,
  createRenderPreparation,
  runWithApplicationRuntime,
  type ApplicationRuntime,
  type RenderEnvironment,
  type RenderPreparation,
} from '@memoized-dom/runtime/core';
import { PublicationClient } from '../host/client';
import { HostError, type Acceptance, type Publication } from '../host/protocol';

export interface NativeApplicationOptions {
  /** Actual frame/visibility capabilities supplied by the owning native host. */
  readonly scheduleFrame: RenderEnvironment['schedule'];
  readonly visible: () => boolean;
  /** Async host/lifecycle failures use the launcher's existing error channel. */
  readonly reportError: (error: unknown) => void;
}

export interface CandidateHooks {
  /** Commit host identities/connected flags before activating shared refs. */
  accepted?(): void;
  /** Schedule subsequent work only after core preparation has activated. */
  activated?(): void;
  /** Release this candidate's host handles before its core-owned cleanup. */
  disposed?(): void;
}

type CandidateState = 'prepared' | 'publishing' | 'active' | 'retiring' | 'disposed';

/**
 * Native acceptance is a capability around the existing semantic runtime.
 * This class owns publication lifetimes, never cells, reads or invalidation.
 */
export class NativeApplication {
  readonly runtime: ApplicationRuntime;
  private readonly candidates = new Set<NativeCandidate<unknown>>();
  private readonly heldEffects = new Map<string, () => void>();
  private readonly effectCleanupOwners = new Set<string>();
  private pending = 0;
  private effectsRefused = false;
  private terminal?: unknown;
  private stopped = false;
  private stopListening: () => void = () => {};

  constructor(
    private readonly client: PublicationClient,
    private readonly options: NativeApplicationOptions,
  ) {
    this.runtime = createApplicationRuntime(undefined, {
      schedule: options.scheduleFrame,
      visible: options.visible,
      refs: 'run',
      effects: 'run',
      effectBoundary: (id, execute) => this.holdEffect(id, execute),
    });
    this.stopListening = client.onClose(error => this.stop(error));

    // An already closed client notifies synchronously during subscription.
    if (this.stopped) {
      this.stopListening();
    }
  }

  get isClosed(): boolean {
    return this.stopped;
  }

  run<T>(work: () => T): T {
    this.assertOpen();

    return runWithApplicationRuntime(this.runtime, work);
  }

  prepare<T>(
    build: (preparation: RenderPreparation) => T,
    hooks: CandidateHooks = {},
  ): NativeCandidate<T> {
    return this.run(() => {
      if (this.runtime.state.preparation !== undefined) {
        throw new HostError('nestedPublication', 'Nested native creation must join its parent publication');
      }

      const preparation = createRenderPreparation();

      try {
        const value = preparation.run(() => build(preparation));
        const candidate = new NativeCandidate(this, preparation, value, hooks);
        this.candidates.add(candidate);
        return candidate;
      } catch (error) {
        // Shared preparation already performs rollback when build throws.
        // Host handles still need their matching disposal notification.
        try {
          hooks.disposed?.();
        } catch (disposal) {
          throw new AggregateError([error, disposal], 'Native candidate build and disposal failed');
        }

        throw error;
      }
    });
  }

  /** Direct sink updates emitted by the compiler, using the same acceptance gate. */
  publishUpdates(publication: Publication): Promise<Acceptance> {
    return this.publish(publication, () => {});
  }

  /** @internal Candidate activation/retirement supplies its accepted action. */
  async publish(publication: Publication, accepted: () => void): Promise<Acceptance> {
    this.assertOpen();

    this.pending++;
    let nativeAccepted = false;

    try {
      const reply = await this.client.publish(publication);
      nativeAccepted = true;
      this.assertOpen();

      this.run(accepted);
      this.effectsRefused = false;

      return reply;
    } catch (error) {
      if (
        !nativeAccepted &&
        !this.client.isClosed &&
        !(error instanceof HostError && error.code === 'sequenceExhausted')
      ) {
        // Existing semantic values are not rolled back. Hold their effects
        // until a corrected scene batch is accepted, never run a refused view.
        this.effectsRefused = true;
      } else if (!this.stopped) {
        this.stop(error);
      }

      throw error;
    } finally {
      this.pending--;

      if (!this.stopped && this.pending === 0 && !this.effectsRefused) {
        this.flushEffects();
      }
    }
  }

  /** @internal Disposal stays in the owning shared runtime scope. */
  release(candidate: NativeCandidate<unknown>): void {
    this.candidates.delete(candidate);
  }

  close(): void {
    this.stop();
  }

  private assertOpen(): void {
    if (this.stopped) {
      throw this.terminal ?? new HostError('closed', 'Native application is closed');
    }
  }

  private holdEffect(id: string, execute: () => void): void {
    if (this.stopped) {
      return;
    }

    if (this.pending === 0 && !this.effectsRefused) {
      execute();
      return;
    }

    this.heldEffects.set(id, execute);

    if (!this.effectCleanupOwners.has(id)) {
      this.effectCleanupOwners.add(id);
      cleanup(id, () => {
        this.heldEffects.delete(id);
        this.effectCleanupOwners.delete(id);
      });
    }
  }

  private flushEffects(): void {
    const held = [...this.heldEffects.entries()];
    this.heldEffects.clear();

    try {
      this.run(() => {
        for (const [id, execute] of held) {
          if (this.stopped) {
            break;
          }

          this.holdEffect(id, execute);
        }
      });
    } catch (error) {
      this.stop(error);
      throw error;
    }
  }

  private stop(error?: unknown): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.terminal = error;
    this.stopListening();
    this.heldEffects.clear();
    this.client.close();
    const errors: unknown[] = error === undefined ? [] : [error];

    runWithApplicationRuntime(this.runtime, () => {
      // Reverse creation order matches owned subtree teardown, with core
      // preparation handling actual parent/child and ref/effect disposal.
      for (const candidate of [...this.candidates].reverse()) {
        try {
          candidate.disposeOwned();
        } catch (cause) {
          errors.push(cause);
        }
      }

      try {
        this.runtime.dispose();
      } catch (cause) {
        errors.push(cause);
      }
    });

    this.candidates.clear();
    this.effectCleanupOwners.clear();

    if (errors.length !== 0) {
      const reported = errors.length === 1
        ? errors[0]
        : new AggregateError(errors, 'Native application failure and cleanup errors');

      this.options.reportError(reported);
    }
  }
}

/** Compiler-owned candidate. Applications continue to use ordinary mount(). */
export class NativeCandidate<T> {
  private state: CandidateState = 'prepared';
  private hooksDisposed = false;

  constructor(
    private readonly application: NativeApplication,
    private readonly preparation: RenderPreparation,
    readonly value: T,
    private readonly hooks: CandidateHooks,
  ) {}

  get status(): CandidateState {
    return this.state;
  }

  async publish(publication: Publication): Promise<Acceptance> {
    if (this.state !== 'prepared') {
      throw new HostError('invalidCandidate', 'Only a prepared native candidate can publish');
    }

    if (this.preparation.readiness !== 'ready') {
      throw new HostError('candidateNotReady', 'Consumed resources/render discovery must settle before publication');
    }

    this.state = 'publishing';

    try {
      return await this.application.publish(publication, () => {
        this.hooks.accepted?.();
        this.preparation.activate();
        this.state = 'active';
        this.hooks.activated?.();
      });
    } catch (error) {
      if (this.status !== 'disposed') {
        try {
          this.application.run(() => this.disposeOwned());
        } catch (disposal) {
          throw new AggregateError([error, disposal], 'Native publication and candidate disposal failed');
        }
      }

      throw error;
    }
  }

  async retire(publication: Publication): Promise<Acceptance> {
    if (this.state !== 'active') {
      throw new HostError('invalidCandidate', 'Only an active native candidate can retire');
    }

    this.state = 'retiring';

    try {
      return await this.application.publish(publication, () => this.disposeOwned());
    } catch (error) {
      // Known refusal preserves the old accepted lifetime. Fatal connection
      // failure already disposed it through the application shutdown path.
      if (this.state === 'retiring') {
        this.state = 'active';
      }

      throw error;
    }
  }

  discard(): void {
    if (this.state === 'disposed') {
      return;
    }

    if (this.state !== 'prepared') {
      throw new HostError('invalidCandidate', 'Published native ownership requires accepted retirement');
    }

    this.application.run(() => this.disposeOwned());
  }

  /** @internal Connection shutdown or accepted retirement owns this operation. */
  disposeOwned(): void {
    if (this.state === 'disposed') {
      return;
    }

    this.state = 'disposed';
    const errors: unknown[] = [];

    if (!this.hooksDisposed) {
      this.hooksDisposed = true;
      try {
        this.hooks.disposed?.();
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      this.preparation.dispose();
    } catch (error) {
      errors.push(error);
    }

    this.application.release(this);

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, 'Native candidate cleanup failed');
    }
  }
}
