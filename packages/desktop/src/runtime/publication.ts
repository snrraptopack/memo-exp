import type { DesktopHost, SceneHandle, SceneMeasurement, SceneOperation, SceneTemplate } from '../bridge/protocol';

/** Prepared changes advance owner caches only after the whole batch is accepted. */
export interface PreparedPublication {
  readonly operation?: SceneOperation;
  readonly operations?: readonly SceneOperation[];
  accept(): void;
  reject(): void;
}
interface Request {
  prepare(): PreparedPublication;
  resolve(): void;
  reject(error: unknown): void;
}

/** One ordered host connection. Installations form barriers between batches. */
export function createPublicationQueue(host: DesktopHost) {
  let sequence = 0;
  let tail = Promise.resolve();
  let pending: Request[] = [];
  let scheduled = false;
  let failure: Error | undefined;
  const noteFailure = (error: unknown): void => {
    if (error instanceof Error && 'acceptance' in error && error.acceptance === 'unknown') failure = error;
  };

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(() => {}, () => {});
    return result;
  };
  const seal = (): void => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    void serialize(async () => {
      const prepared: PreparedPublication[] = [];
      try {
        if (failure) throw failure;
        // No command reaches the host until every destination has been read.
        for (const request of batch) prepared.push(request.prepare());
        const operations = prepared.flatMap(item => item.operations ? [...item.operations] : item.operation ? [item.operation] : []);
        if (operations.length) {
          const expected = sequence + 1;
          if (!Number.isSafeInteger(expected)) throw new Error('Desktop transaction sequence exhausted');
          const ack = await host.commit({ sequence: expected, operations });
          if (!ack || ack.sequence !== expected) {
            // Acceptance is ambiguous. Reusing the sequence could duplicate a
            // committed transaction; retire publication instead of guessing.
            failure = new Error('Desktop host acknowledged the wrong transaction');
            throw failure;
          }
          sequence = expected;
        }
        for (const item of prepared) item.accept();
        for (const request of batch) request.resolve();
      } catch (error) {
        noteFailure(error);
        for (const item of prepared) item.reject();
        for (const request of batch) request.reject(error);
      }
    });
  };

  return {
    setFocus(handle: SceneHandle, node: number, focused: boolean, preventScroll = false): Promise<void> {
      seal();
      return serialize(async () => {
        if (failure) throw failure;
        if (!host.setFocus) throw new Error('Desktop host does not support element focus');
        await host.setFocus(handle, node, focused, preventScroll);
      });
    },
    measure(handle: SceneHandle, node: number): Promise<SceneMeasurement> {
      // Read accepted geometry after any publications already requested. Do not
      // flush the caller's owner here: this can run inside its active handler.
      seal();
      return serialize(async () => {
        if (failure) throw failure;
        if (!host.measure) throw new Error('Desktop host does not support element measurement');
        return host.measure(handle, node);
      });
    },
    install(template: SceneTemplate): Promise<void> {
      // A new installation cannot overtake a batch already requested.
      seal();
      return serialize(async () => {
        if (failure) throw failure;
        try { await host.install(template); } catch (error) { noteFailure(error); throw error; }
      });
    },
    publish(prepare: Request['prepare']): Promise<void> {
      const result = new Promise<void>((resolve, reject) => { pending.push({ prepare, resolve, reject }); });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => { scheduled = false; seal(); });
      }
      return result;
    },
  };
}
