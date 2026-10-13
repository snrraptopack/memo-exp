/**
 * Build/launch selection only. It does not change compiler analysis, application
 * authoring or the publication protocol, and never guesses another engine's APIs.
 */
export interface ExecutionBackend {
  readonly name: string;
  /** Executable followed by fixed arguments; passed without a shell. */
  readonly command: readonly [string, ...string[]];
  readonly moduleFormat: 'esm' | 'cjs';
  /** Bundler resolution policy; portable engines default to browser-style JS. */
  readonly bundleTarget?: 'node' | 'browser';
  /** Runtime-provided module names, for example a QuickJS host's std/os. */
  readonly external?: readonly string[];
  /**
   * Build-time adapter module exporting connectNativeHost(NativeProcessOptions).
   * Custom engines supply this module; the semantic client remains identical.
   */
  readonly hostAdapter: string;
}

export type RuntimeSelection = 'bun' | 'node' | ExecutionBackend;

const nodeCompatibleAdapter = new URL('../host/node-process.ts', import.meta.url).href;

export function resolveExecutionBackend(runtime: RuntimeSelection = 'bun'): ExecutionBackend {
  if (runtime === 'bun' || runtime === 'node') {
    return {
      name: runtime,
      command: [runtime],
      moduleFormat: 'esm',
      bundleTarget: 'node',
      hostAdapter: nodeCompatibleAdapter,
    };
  }
  if (
    typeof runtime !== 'object' || runtime === null ||
    typeof runtime.name !== 'string' || runtime.name.length === 0 ||
    !Array.isArray(runtime.command) || !runtime.command[0] ||
    !runtime.command.every(argument => typeof argument === 'string' && !argument.includes('\0')) ||
    (runtime.moduleFormat !== 'esm' && runtime.moduleFormat !== 'cjs') ||
    typeof runtime.hostAdapter !== 'string' || runtime.hostAdapter.length === 0
  ) {
    throw new Error('Custom execution backends require name, command, moduleFormat and hostAdapter');
  }
  if (
    (runtime.bundleTarget !== undefined &&
      runtime.bundleTarget !== 'node' && runtime.bundleTarget !== 'browser') ||
    (runtime.external !== undefined &&
      (!Array.isArray(runtime.external) || !runtime.external.every(name => typeof name === 'string')))
  ) {
    throw new Error('Custom execution backend bundler settings are invalid');
  }
  return {
    ...runtime,
    command: [...runtime.command] as [string, ...string[]],
    external: runtime.external ? [...runtime.external] : undefined,
  };
}

export function executionCommand(
  entry: string,
  runtime: RuntimeSelection = 'bun',
  argumentsAfterEntry: readonly string[] = [],
): readonly [string, ...string[]] {
  const backend = resolveExecutionBackend(runtime);
  return [...backend.command, entry, ...argumentsAfterEntry] as [string, ...string[]];
}
