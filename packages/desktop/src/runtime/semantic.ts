/** Connect shared entity scheduling to asynchronous native publication. */
import {
  commit,
  createApplicationRuntime,
  markDirty,
  registerEntity,
  runWithApplicationRuntime,
  setScheduler,
  unregisterSubtree,
  type DirtyReasons,
} from '@memoized-dom/runtime/core';
import { configureNodeContext } from '@memoized-dom/runtime/node-context';
import { initializeSceneModules } from './modules';

// Local writes already carry their exact source set in the scene owner.
// A full routed invalidation dominates this reason in the shared kernel.
const LOCAL_WRITE = 'desktop:local';

interface PublicationJob {
  publish(): Promise<void>;
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
  observed: boolean;
}

function publicationJob(publish: PublicationJob['publish']): PublicationJob {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  // Automatic programmatic updates may finish before an explicit flush.
  // Their failures are retained below, without an unhandled rejection.
  void promise.catch(() => {});
  return { publish, promise, resolve, reject, observed: false };
}

export function createSceneSemanticRuntime() {
  configureNodeContext();
  const effects = new Map<string, () => void>();
  const activations = new Map<string, () => void>();
  const holds = new Set<Promise<void>>();
  const runtime = createApplicationRuntime(undefined, {
    schedule: null,
    effects: 'run',
    refs: 'run',
    effectBoundary(id, execute) {
      effects.set(id, execute);
    },
  });
  const run = <T>(callback: () => T): T => runWithApplicationRuntime(runtime, callback);
  let closed = false;
  let lifecycleReady = false;
  let lifecycleStopped = false;
  const pending = new Map<object, PublicationJob>();
  const running = new Map<object, PublicationJob>();
  const failed = new Set<PublicationJob>();
  const rejectedFamilies = new Set<object>();
  const drainFailures: unknown[] = [];
  let collecting: Set<PublicationJob> | undefined;
  const releaseLifecycle = (): void => {
    if (
      closed ||
      !lifecycleReady ||
      lifecycleStopped ||
      holds.size ||
      pending.size ||
      running.size ||
      rejectedFamilies.size ||
      drainFailures.length ||
      runtime.state.dirty.size
    )
      return;
    // A callback can write state. Finish that render before invoking another
    // queued lifecycle callback against its accepted element handles.
    for (const queue of [activations, effects])
      for (const [id, callback] of queue) {
        queue.delete(id);
        try {
          run(callback);
        } catch (error) {
          drainFailures.push(error);
        }
        if (runtime.state.dirty.size || drainFailures.length) return;
      }
  };

  const request = (family: object, publish: PublicationJob['publish']): PublicationJob => {
    let job = pending.get(family);
    if (!job) {
      job = publicationJob(publish);
      pending.set(family, job);
    }
    collecting?.add(job);
    return job;
  };
  const startPublication = (): void => {
    for (const [family, job] of pending) {
      if (running.has(family)) continue;
      pending.delete(family);
      running.set(family, job);
      void run(job.publish)
        .then(
          () => {
            rejectedFamilies.delete(family);
            job.resolve();
          },
          (error) => {
            rejectedFamilies.add(family);
            if (!job.observed) failed.add(job);
            job.reject(error);
          },
        )
        .finally(() => {
          running.delete(family);
          // Writes during the host wait belong to a later job. Its promise is
          // distinct, so a rejected earlier transaction cannot reject it too.
          startPublication();
          releaseLifecycle();
        });
    }
  };

  run(() => {
    registerEntity({ id: 'Desktop', parent: null, render() {} });
    setScheduler((drain) =>
      queueMicrotask(() => {
        if (closed) return;
        try {
          run(drain);
        } catch (error) {
          drainFailures.push(error);
        }
        startPublication();
        releaseLifecycle();
      }),
    );
  });

  const drain = (): Set<PublicationJob> => {
    const jobs = new Set<PublicationJob>();
    const previous = collecting;
    collecting = jobs;
    try {
      if (!closed)
        run(() => {
          initializeSceneModules();
          commit();
        });
    } finally {
      collecting = previous;
    }
    return jobs;
  };

  return {
    run,
    initialize(ids: readonly string[] = []) {
      run(() => {
        initializeSceneModules(ids);
        commit();
      });
    },
    register(id: string, parent: string, update: (full: boolean) => void): void {
      run(() =>
        registerEntity({
          id,
          parent,
          render(reasons?: DirtyReasons) {
            const local =
              reasons === LOCAL_WRITE ||
              (reasons !== null && typeof reasons === 'object' && reasons.has(LOCAL_WRITE));
            update(!local);
          },
        }),
      );
    },
    unregister(id: string): void {
      activations.delete(id);
      try {
        run(() => unregisterSubtree(id));
      } catch (error) {
        drainFailures.push(error);
      }
    },
    activate(id: string, callback: () => void): void {
      lifecycleReady = true;
      activations.set(id, callback);
    },
    hold(ready: Promise<void>): void {
      holds.add(ready);
      void ready.then(
        () => {
          holds.delete(ready);
          releaseLifecycle();
        },
        () => {
          holds.delete(ready);
          // Initial readiness owns this rejection. Reporting it again during
          // disposal would turn successful construction cleanup into failure.
          // Keep lifecycle work blocked until the failed family is retired.
          rejectedFamilies.add(ready);
        },
      );
    },
    releaseHold(ready: Promise<void>): void {
      holds.delete(ready);
      rejectedFamilies.delete(ready);
    },
    stopLifecycle(): void {
      lifecycleStopped = true;
    },
    invalidateLocal(id: string): void {
      run(() => markDirty(id, LOCAL_WRITE));
    },
    request,
    reportAsync(error: unknown): void {
      drainFailures.push(error);
    },
    /** Wait for this drain's jobs, without adopting an earlier in-flight failure. */
    async flush(retry?: () => Promise<void>, family?: object): Promise<void> {
      for (let pass = 0; pass < 100; pass++) {
        const jobs = drain();
        if (pass === 0 && retry && family) {
          jobs.add(pending.get(family) ?? running.get(family) ?? request(family, retry));
        } else if (!family) {
          for (const job of [...pending.values(), ...running.values(), ...failed]) jobs.add(job);
        }
        for (const job of jobs) {
          job.observed = true;
          failed.delete(job);
        }
        startPublication();
        const results = await Promise.allSettled([...jobs].map((job) => job.promise));
        releaseLifecycle();
        const errors = new Set([
          ...drainFailures.splice(0),
          ...results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
        ]);
        if (errors.size === 1) throw [...errors][0];
        if (errors.size) throw new AggregateError(errors, 'Desktop semantic publication failed');
        if (!runtime.state.dirty.size && !pending.size && !running.size) return;
      }
      throw new Error('Desktop effect cascade exceeded 100 publications');
    },
    dispose(): void {
      closed = true;
      pending.clear();
      failed.clear();
      rejectedFamilies.clear();
      activations.clear();
      effects.clear();
      run(() => runtime.dispose());
    },
  };
}

export type SceneSemanticRuntime = ReturnType<typeof createSceneSemanticRuntime>;
