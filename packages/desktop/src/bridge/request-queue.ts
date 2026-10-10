/** Bounded FIFO admission and serialized writes for one process connection. */
interface Entry {
  id: number;
  line: string;
  bytes: number;
  sent: boolean;
  deadline?: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
export interface RequestLimits {
  maxPendingRequests: number;
  maxPendingBytes: number;
  maxInFlightRequests: number;
}
export function requestLimits(options: Partial<RequestLimits>): RequestLimits {
  const limits = {
    maxPendingRequests: options.maxPendingRequests ?? 256,
    maxPendingBytes: options.maxPendingBytes ?? 8 * 1024 * 1024,
    maxInFlightRequests: options.maxInFlightRequests ?? 32,
  };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError('Desktop request limits require positive safe integers');
    }
  }
  return limits;
}
export function createRequestQueue(
  limits: RequestLimits,
  write: (line: string) => Promise<void>,
  onFailure: (error: Error) => void,
) {
  const pending = new Map<number, Entry>();
  let waiting: Entry[] = [];
  let bytes = 0;
  let inFlight = 0;
  let pumping = false;
  let failure: Error | undefined;
  const pump = (): void => {
    if (pumping || failure) return;
    pumping = true;
    void (async () => {
      try {
        while (!failure && waiting.length && inFlight < limits.maxInFlightRequests) {
          const entry = waiting.shift()!;
          // A response may arrive before the write's flush promise settles.
          // Mark admission first while keeping the next writer serialized.
          entry.sent = true;
          inFlight++;
          await write(entry.line);
        }
      } catch (error) {
        onFailure(error instanceof Error ? error : new Error(String(error)));
      } finally {
        pumping = false;
      }
    })();
  };
  return {
    get size() {
      return pending.size;
    },
    enqueue(id: number, line: string, kind: string, timeout: number): Promise<unknown> {
      if (failure) return Promise.reject(failure);
      const size = Buffer.byteLength(line, 'utf8');
      // Keep finite admission reserves for publication/input/focus acknowledgments and
      // one shutdown, so diagnostic floods cannot consume every control slot.
      const control = ['apply', 'acknowledge', 'event_result', 'shutdown'].includes(kind);
      const reserve = kind === 'shutdown' ? 3 : control ? 2 : 0;
      if (
        pending.size >= limits.maxPendingRequests + reserve ||
        bytes + size >
          limits.maxPendingBytes + (control ? 65_536 : 0) + (kind === 'shutdown' ? 1024 : 0)
      ) {
        return Promise.reject(
          new Error('Desktop bridge capacity exceeded before request publication'),
        );
      }
      return new Promise((resolve, reject) => {
        const entry: Entry = { id, line, bytes: size, sent: false, resolve, reject };
        if (timeout)
          entry.deadline = setTimeout(() => {
            if (entry.sent) {
              onFailure(new Error(`Desktop host timed out during ${kind}`));
              return;
            }
            pending.delete(id);
            waiting = waiting.filter((queued) => queued !== entry);
            bytes -= entry.bytes;
            entry.reject(new Error(`Desktop request timed out before publication during ${kind}`));
            pump();
          }, timeout);
        pending.set(id, entry);
        waiting.push(entry);
        bytes += size;
        pump();
      });
    },
    settle(id: number, result: unknown, error?: string): void {
      const entry = pending.get(id);
      if (!entry?.sent) throw new Error(`Unknown desktop host response id ${id}`);
      pending.delete(id);
      clearTimeout(entry.deadline);
      bytes -= entry.bytes;
      inFlight--;
      if (error !== undefined) entry.reject(new Error(error));
      else entry.resolve(result);
      pump();
    },
    fail(error: Error): void {
      failure ??= error;
      for (const entry of pending.values()) {
        clearTimeout(entry.deadline);
        entry.reject(error);
      }
      pending.clear();
      waiting = [];
      bytes = 0;
      inFlight = 0;
    },
  };
}
