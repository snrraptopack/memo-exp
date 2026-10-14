/** Shared bounded packet writes; native decisions can pass pending scene replies. */
import { HostError } from './protocol';
import type { PublicationTransport } from './transport';

interface WriteJob {
  readonly json: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export class PacketWriter {
  private readonly queued: WriteJob[] = [];
  private active?: WriteJob;
  private terminal?: Error;

  constructor(private readonly transport: PublicationTransport) {}

  send(json: string): Promise<void> {
    if (this.terminal) return Promise.reject(this.terminal);
    if (this.queued.length + Number(this.active !== undefined) >= 8) {
      return Promise.reject(new HostError('writeQueueFull', 'Native packet write queue is full'));
    }
    return new Promise((resolve, reject) => {
      this.queued.push({ json, resolve, reject });
      this.drain();
    });
  }

  close(error: Error): void {
    if (this.terminal) return;
    this.terminal = error;
    this.active?.reject(error);
    this.active = undefined;
    for (const job of this.queued.splice(0)) job.reject(error);
  }

  private drain(): void {
    if (this.terminal || this.active || this.queued.length === 0) return;
    const job = this.queued.shift()!;
    this.active = job;
    let sent: Promise<void>;
    try {
      sent = this.transport.send(job.json);
    } catch (error) {
      sent = Promise.reject(error);
    }
    void sent.then(() => {
      if (this.active !== job || this.terminal) return;
      this.active = undefined;
      job.resolve();
      this.drain();
    }, error => {
      this.close(error instanceof Error ? error : new HostError('writeFailed', String(error)));
    });
  }
}
