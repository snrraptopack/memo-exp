type Listener<T> = (value: T) => void;

function reportListenerErrors(errors: readonly unknown[]): void {
  if (errors.length === 0) return;
  const error = errors.length === 1
    ? errors[0]
    : new AggregateError(errors, 'Data runtime listeners failed');
  const reporter = (globalThis as typeof globalThis & {
    reportError?: (error: unknown) => void;
  }).reportError;
  try {
    reporter?.(error);
  } catch {
    // Reporting is best-effort. A host reporter must not make a completed
    // resource transition fail after a subscriber error was isolated.
  }
}

/** Reentrancy-safe notification queue shared by resources and actions. */
export class SnapshotNotifier<T> {
  readonly listeners = new Set<Listener<T>>();
  private emitting = false;
  private pending = false;

  constructor(private readonly current: () => T) {}

  notify(): void {
    if (this.emitting) {
      this.pending = true;
      return;
    }

    this.emitting = true;
    const errors: unknown[] = [];
    try {
      do {
        this.pending = false;
        const value = this.current();
        for (const listener of [...this.listeners]) {
          if (!this.listeners.has(listener)) continue;
          try {
            listener(value);
          } catch (error) {
            errors.push(error);
          }
          if (this.pending) break;
        }
      } while (this.pending);
    } finally {
      this.emitting = false;
    }
    reportListenerErrors(errors);
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    try {
      listener(this.current());
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.listeners.clear();
  }
}
