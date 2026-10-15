import {
  HostError,
  PROTOCOL_VERSION,
  PublicationRefusedError,
  parseReply,
  type Acceptance,
  type Publication,
  type PublicationReply,
} from './protocol';
import type { PublicationTransport } from './transport';
import { snapshotPublication } from './serialization';
import { PacketWriter } from './writer';
import { parseNativeEvent, type NativeEventPacket, type DispatchDecision, type NativeDispatchResult } from './events';

interface Job {
  readonly body: string;
  readonly resolve: (accepted: Acceptance) => void;
  readonly reject: (error: Error) => void;
}

interface ActivePublication {
  readonly job: Job;
  readonly sequence: number;
  cancelDeadline: () => void;
  sent: boolean;
  reply?: PublicationReply;
}

export interface ClientOptions {
  /** Graphical launch waits for window/GPU initialization before publishing. */
  readonly requireReady?: boolean;
  /** Includes the active publication. Pressure refuses locally, without I/O. */
  readonly maxPending?: number;
  readonly acknowledgmentTimeoutMs?: number;
  /** Launcher-owned synchronous dispatch, independent of scene acceptance. */
  readonly dispatch?: (event: NativeEventPacket) => boolean | NativeDispatchResult;
}

/**
 * One acceptance boundary for every execution engine. This owns only transport
 * jobs and sequence ordering; state, refs and effects stay in the shared core.
 */
export class PublicationClient {
  private readonly queue: Job[] = [];
  private readonly maxPending: number;
  private readonly timeoutMs: number;
  private active?: ActivePublication;
  private nextSequence = 1;
  private terminal?: Error;
  private readonly closeListeners = new Set<(error: Error) => void>();
  private readonly capacityListeners = new Set<() => void>();
  private unsubscribe: () => void = () => {};
  private readonly writer: PacketWriter;
  private readonly dispatch?: ClientOptions['dispatch'];
  private lastDispatch = 0;
  private readonly events: NativeEventPacket[] = [];
  private eventsScheduled = false;
  private readyReceived = false;
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;
  private cancelReadyDeadline: () => void = () => {};

  constructor(
    private readonly transport: PublicationTransport,
    options: ClientOptions = {},
  ) {
    this.writer = new PacketWriter(transport);
    this.dispatch = options.dispatch;
    if (options.requireReady) {
      this.readyPromise = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      void this.readyPromise.catch(() => {});
      this.cancelReadyDeadline = transport.scheduleDeadline(30_000, () => {
        this.fail(new HostError('startupTimedOut', 'Native window initialization timed out'));
      });
    }
    this.maxPending = options.maxPending ?? 8;
    this.timeoutMs = options.acknowledgmentTimeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.maxPending) ||
      this.maxPending < 1 ||
      this.maxPending > 64 ||
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 60_000
    ) {
      throw new HostError('invalidOptions', 'Pending limit or acknowledgment deadline is invalid');
    }

    try {
      this.unsubscribe = transport.listen({
        reply: value => this.receive(value),
        failure: error => {
          if (!this.active && this.queue.length === 0 && this.events.length === 0 &&
              error instanceof HostError && error.code === 'windowClosed') {
            this.fail(error);
            return;
          }
          this.fail(new HostError(
            'acceptanceUnknown',
            'Native connection failed; pending work cannot be replayed',
            { cause: error },
          ));
        },
      });
    } catch (error) {
      this.fail(new HostError('connectionFailed', 'Native listener setup failed', { cause: error }));
    }
    // A custom adapter may synchronously report its existing failure in listen().
    if (this.terminal) runCleanup(this.unsubscribe);
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  get isClosed(): boolean {
    return this.terminal !== undefined;
  }

  /** Admission only; accepted presentation/state still belong to the adapter. */
  get hasCapacity(): boolean {
    return this.terminal === undefined &&
      this.queue.length + Number(this.active !== undefined) < this.maxPending;
  }

  onCapacity(listener: () => void): () => void {
    if (this.terminal !== undefined) return () => {};
    this.capacityListeners.add(listener);
    return () => { this.capacityListeners.delete(listener); };
  }

  /** Connection lifetime, including idle process loss. Not a state subscription. */
  onClose(listener: (error: Error) => void): () => void {
    if (this.terminal) {
      listener(this.terminal);
      return () => {};
    }

    this.closeListeners.add(listener);

    return () => {
      this.closeListeners.delete(listener);
    };
  }

  publish(publication: Publication): Promise<Acceptance> {
    if (this.terminal) return Promise.reject(this.terminal);
    if (this.queue.length + Number(this.active !== undefined) >= this.maxPending) {
      return Promise.reject(new HostError('queueFull', 'Desktop publication queue is full'));
    }
    if (!Number.isSafeInteger(this.nextSequence)) {
      return Promise.reject(new HostError('sequenceExhausted', 'A new native connection is required'));
    }

    let body: string;
    try {
      // Snapshot before enqueue: caller mutation cannot change later queued work.
      // Rust remains the authority for source identities and native topology.
      body = snapshotPublication(publication);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ body, resolve, reject });
      this.pump();
    });
  }

  close(): void {
    this.fail(new HostError('closed', 'Desktop connection was closed; pending work is canceled'));
  }

  private pump(): void {
    if (this.terminal || this.active || this.queue.length === 0) return;
    if (this.resolveReady && !this.readyReceived) return;
    if (!Number.isSafeInteger(this.nextSequence)) {
      this.fail(new HostError('sequenceExhausted', 'A new native connection is required'));
      return;
    }

    const job = this.queue.shift()!;
    const active: ActivePublication = {
      job,
      sequence: this.nextSequence,
      sent: false,
      cancelDeadline: () => {},
    };
    this.active = active;
    try {
      active.cancelDeadline = this.transport.scheduleDeadline(this.timeoutMs, () => {
        // A failed custom cancellation must not let an old timer close a later
        // publication. Its deadline belongs to this exact outstanding job.
        if (this.active === active) {
          this.fail(new HostError('acceptanceUnknown', 'Native acknowledgment timed out; do not replay'));
        }
      });
      if (this.terminal || this.active !== active) {
        // Some engine adapters can synchronously report failure while setting
        // up a deadline. Do not send after that callback closed the connection.
        runCleanup(active.cancelDeadline);
        return;
      }
      const json = '{"version":' + PROTOCOL_VERSION + ',"sequence":' + active.sequence +
        ',' + job.body.slice(1);
      this.writer.send(json).then(
        () => {
          if (this.active !== active || this.terminal) return;
          active.sent = true;
          this.settle(active);
        },
        error => {
          this.fail(new HostError(
            'acceptanceUnknown',
            'Native publication write failed; do not replay',
            { cause: error },
          ));
        },
      );
    } catch (error) {
      this.fail(new HostError('acceptanceUnknown', 'Native transport failed', { cause: error }));
    }
  }

  private receive(value: unknown): void {
    if (this.terminal) return;
    try {
      if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'ready') {
        if (!this.resolveReady || this.readyReceived || Object.keys(value).length !== 2 ||
            !('version' in value) || value.version !== 1 || this.active) {
          throw new HostError('unexpectedReady', 'Native readiness does not match startup');
        }
        this.readyReceived = true;
        this.cancelReadyDeadline();
        this.resolveReady();
        this.pump();
        return;
      }
      if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'event') {
        const event = parseNativeEvent(value);
        if (!this.dispatch || event.dispatchId <= this.lastDispatch) {
          throw new HostError('unexpectedEvent', 'Native event has no dispatcher or duplicates a dispatch');
        }
        this.lastDispatch = event.dispatchId;
        if (event.sceneSequence >= this.nextSequence && event.sceneSequence !== this.active?.sequence) {
          throw new HostError('invalidEventOrder', 'Native event refers to an unknown scene acceptance');
        }
        if (this.events.length >= 8) {
          throw new HostError('eventQueueFull', 'Native dispatch queue is full');
        }
        this.events.push(event);
        this.scheduleEvents();
        return;
      }
      const reply = parseReply(value);
      const active = this.active;
      if (!active || active.reply) {
        throw new HostError('unexpectedReply', 'Native reply has no outstanding publication');
      }
      const sequence = reply.status === 'accepted' ? reply.sequence : reply.expectedSequence;
      if (sequence !== active.sequence && !(reply.status === 'fatal' && sequence === null)) {
        throw new HostError('outOfOrderReply', 'Native reply does not match the outstanding publication');
      }
      if (reply.status === 'fatal') {
        this.fail(new HostError('acceptanceUnknown', reply.message));
        return;
      }
      active.reply = reply;
      this.settle(active);
    } catch (error) {
      this.fail(error instanceof Error ? error : new HostError('invalidReply', String(error)));
    }
  }

  private settle(active: ActivePublication): void {
    if (!active.sent || !active.reply) return;
    runCleanup(active.cancelDeadline);
    this.active = undefined;

    if (active.reply.status === 'accepted') {
      this.nextSequence++;
      active.job.resolve(active.reply);
      this.pump();
      this.scheduleEvents();
    } else {
      active.job.reject(new PublicationRefusedError(active.reply));
      // Queued work may depend on the refused mount/template. Do not advance it
      // blindly; let the semantic adapter recompute a corrected candidate batch.
      this.rejectQueued(new HostError('predecessorRefused', 'Earlier publication was refused'));
    }

    // Owner acceptance/refusal continuations run first. Retried presentation
    // must observe their attached or discarded subtrees, not a half-settled job.
    void Promise.resolve().then(() => {
      if (!this.hasCapacity) return;
      const listeners = [...this.capacityListeners];

      for (const listener of listeners) {
        if (this.capacityListeners.has(listener)) runCleanup(listener);
      }
    });
  }

  private fail(error: Error): void {
    if (this.terminal) return;
    this.terminal = error;
    this.cancelReadyDeadline();
    this.rejectReady?.(error);
    this.writer.close(error);
    this.events.length = 0;
    const active = this.active;
    this.active = undefined;
    active?.job.reject(error);
    this.rejectQueued(error);
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    this.capacityListeners.clear();
    // Pending jobs settle even if a custom adapter's cleanup throws. The first
    // terminal failure remains authoritative; teardown must never strand jobs.
    for (const cleanup of [
      this.unsubscribe,
      active?.cancelDeadline ?? (() => {}),
      () => this.transport.dispose(),
      ...listeners.map(listener => () => listener(error)),
    ]) {
      runCleanup(cleanup);
    }
  }

  private rejectQueued(error: Error): void {
    for (const job of this.queue.splice(0)) job.reject(error);
  }

  private scheduleEvents(): void {
    if (this.eventsScheduled || this.events.length === 0 || this.terminal) return;
    this.eventsScheduled = true;
    // An accepted publication resolves its owner continuation first. Dispatch
    // then observes activated refs/bindings even when frames arrive together.
    void Promise.resolve().then(() => {
      this.eventsScheduled = false;
      try {
        while (this.events.length > 0 && !this.terminal) {
          const event = this.events[0]!;
          if (event.sceneSequence >= this.nextSequence) return;
          this.events.shift();
          const result = this.dispatch!(event);
          const cancelled = typeof result === 'boolean' ? result : result?.cancelled;
          if (typeof cancelled !== 'boolean') {
            throw new HostError('invalidDecision', 'Native dispatch must return its synchronous cancellation decision');
          }
          const controls = typeof result === 'boolean' ? undefined : result.controls;
          const decision: DispatchDecision = {
            kind: 'dispatchResult', version: 1, dispatchId: event.dispatchId, cancelled,
            ...(controls?.length ? { controls } : {}),
          };
          void this.writer.send(JSON.stringify(decision)).catch(error => this.fail(error));
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new HostError('dispatchFailed', String(error)));
      }
    });
  }
}

function runCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // Teardown failure cannot prevent job settlement or resurrect native work.
  }
}
