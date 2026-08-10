export interface OracleComputation {
  id: string;
  key: string;
  run(): unknown;
}

export interface ConcreteStep {
  writes: string[];
  dependenciesBefore: Record<string, string[]>;
  changed: string[];
}

export class OracleRuntime {
  private current: string | null = null;
  private readonly dependencies = new Map<string, Set<string>>();
  private readonly pendingDependencies = new Set<string>();
  private readonly objectKeys = new WeakMap<object, string>();
  private readonly writes = new Set<string>();
  private readonly values = new Map<string, unknown>();

  readonly api = {
    read: <T>(key: string, value: T): T => {
      if (this.current !== null) this.pendingDependencies.add(key);
      return value;
    },
    readObject: <T>(object: object, path: string, value: T): T => {
      const root = this.objectKeys.get(object);
      if (root !== undefined && this.current !== null) {
        this.pendingDependencies.add(path === '' ? root : `${root}.${path}`);
      }
      return value;
    },
    write: (key: string): void => {
      this.writes.add(key);
    },
    writeObject: (object: object, path: string): void => {
      const root = this.objectKeys.get(object);
      if (root !== undefined) this.writes.add(path === '' ? root : `${root}.${path}`);
    },
    registerObject: (key: string, object: unknown): void => {
      if (object !== null && typeof object === 'object') this.objectKeys.set(object, key);
    },
  };

  initialize(computations: readonly OracleComputation[]): void {
    for (const computation of computations) this.execute(computation);
    this.writes.clear();
  }

  executeMutation(
    mutation: () => void,
    computations: readonly OracleComputation[],
  ): ConcreteStep {
    const dependenciesBefore = Object.fromEntries(
      [...this.dependencies.entries()].map(([id, keys]) => [id, [...keys].sort()]),
    );
    this.writes.clear();
    mutation();
    const writes = [...this.writes].sort();
    this.writes.clear();
    const changed: string[] = [];
    for (const computation of computations) {
      const previous = this.values.get(computation.id);
      const next = this.execute(computation);
      if (!Object.is(previous, next)) changed.push(computation.id);
    }
    return {
      writes,
      dependenciesBefore,
      changed,
    };
  }

  private execute(computation: OracleComputation): unknown {
    this.current = computation.id;
    this.pendingDependencies.clear();
    try {
      const value = computation.run();
      this.dependencies.set(computation.id, new Set(this.pendingDependencies));
      this.values.set(computation.id, value);
      return value;
    } finally {
      this.current = null;
      this.pendingDependencies.clear();
    }
  }
}

export function pathsTouch(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}
