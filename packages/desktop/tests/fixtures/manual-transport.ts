import type { PublicationTransport, TransportObserver } from '../../src/host/transport';

/** Deterministic engine adapter for publication/lifecycle contracts. */
export class ManualTransport implements PublicationTransport {
  observer?: TransportObserver;
  readonly sent: string[] = [];
  disposed = false;
  deadline?: () => void;
  write?: (json: string) => Promise<void>;

  send(json: string): Promise<void> {
    this.sent.push(json);
    return this.write?.(json) ?? Promise.resolve();
  }

  listen(observer: TransportObserver): () => void {
    this.observer = observer;
    return () => { this.observer = undefined; };
  }

  scheduleDeadline(_milliseconds: number, callback: () => void): () => void {
    this.deadline = callback;
    return () => { this.deadline = undefined; };
  }

  dispose(): void { this.disposed = true; }

  accept(sequence: number): void {
    this.observer?.reply({ version: 1, status: 'accepted', sequence });
  }

  refuse(sequence: number): void {
    this.observer?.reply({
      version: 1, status: 'refused', expectedSequence: sequence,
      code: 'unknownSource', message: 'Source does not exist',
    });
  }
}
