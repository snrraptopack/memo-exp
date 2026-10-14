/**
 * Engine capability boundary. Implementations own UTF-8 framing, native process
 * lifetime and deadlines. The client imports no Bun/Node APIs or browser globals.
 */
export interface TransportObserver {
  reply(value: unknown): void;
  failure(error: Error): void;
}

export interface PublicationTransport {
  /** Resolves when the entire framed packet has been written, not accepted. */
  send(json: string): Promise<void>;
  /** Install one observer before sending. May report an already failed stream. */
  listen(observer: TransportObserver): () => void;
  scheduleDeadline(milliseconds: number, callback: () => void): () => void;
  /** Idempotently stop I/O and terminate the owned native host without waiting. */
  dispose(): void;
}

export interface NativeProcessOptions {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Optional launch diagnostics; they do not acknowledge native work. */
  readonly diagnostics?: (text: string) => void;
}
