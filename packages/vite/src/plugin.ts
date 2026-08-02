/**
 * Vite 8 plugin backed by connected compiler graphs and live module HMR.
 */
import type {
  DevEnvironment,
  MinimalPluginContextWithoutEnvironment,
  Plugin,
  ResolvedConfig,
} from 'vite';
import { parseSync } from 'vite';
import type { GraphPluginContext } from './graph/collector';
import { compileGraph } from './graph/collector';
import { invalidateManagedModules } from './hmr';
import {
  resolveAdapterOptions,
  type MemoizedDomViteOptions,
} from './options';
import { cleanViteId, entryFiles, normalizeFile } from './paths';
import { AdapterState } from './state';

const sourceId = /\.[jt]sx?(?:$|[?#])/;

interface AdapterTransformContext extends GraphPluginContext {
  environment: object;
}

export function memoizedDom(
  input: MemoizedDomViteOptions,
): Plugin {
  const options = resolveAdapterOptions(input);
  const states = new Map<object, AdapterState>();
  let config: ResolvedConfig | undefined;
  let entries: readonly string[] = [];

  function stateFor(environment: object): AdapterState {
    let state = states.get(environment);
    if (state === undefined) {
      state = new AdapterState();
      states.set(environment, state);
    }
    return state;
  }

  function graphContext(
    context: GraphPluginContext,
  ): GraphPluginContext {
    return {
      parse: (source, parserOptions) =>
        context.parse(source, parserOptions),
      resolve: (specifier, importer, resolveOptions) =>
        context.resolve(specifier, importer, resolveOptions),
      addWatchFile: (watched) => context.addWatchFile(watched),
      error: (error) => context.error(error),
    };
  }

  function hotGraphContext(
    environment: DevEnvironment,
    context: MinimalPluginContextWithoutEnvironment,
  ): GraphPluginContext {
    return {
      parse: (source, parserOptions) =>
        parseSync(`module.${parserOptions.lang}`, source, parserOptions)
          .program,
      async resolve(specifier, importer) {
        const resolved =
          await environment.pluginContainer.resolveId(specifier, importer);
        return resolved === null
          ? null
          : { id: resolved.id, external: resolved.external };
      },
      addWatchFile: (watched) =>
        environment.pluginContainer.watchFiles.add(watched),
      error: (error) => context.error(error),
    };
  }

  async function refreshGraph(
    context: GraphPluginContext,
    state: AdapterState,
    overrides: ReadonlyMap<string, string> = new Map(),
  ): Promise<void> {
    if (config === undefined) {
      throw new Error(
        'memoized-dom: Vite graph compilation started before config resolution',
      );
    }
    if (state.compiling === undefined) {
      state.compiling = compileGraph(
        graphContext(context),
        config.root,
        entries,
        options,
        overrides,
        config.command === 'serve',
      );
    }
    const compilation = state.compiling;
    try {
      state.replace(await compilation);
    } finally {
      if (state.compiling === compilation) {
        state.compiling = undefined;
      }
    }
  }

  async function transformModule(
    context: AdapterTransformContext,
    code: string,
    id: string,
  ): Promise<{ code: string; map: null } | null> {
    if (config === undefined || !sourceId.test(id)) return null;
    const file = cleanViteId(id);
    const state = stateFor(context.environment);
    const managed = entries.includes(file) || state.files.has(file);
    if (!managed && state.compiling === undefined) return null;

    const cached = state.output.get(file);
    if (cached !== undefined) return { code: cached, map: null };

    if (state.compiling === undefined) {
      await refreshGraph(
        context,
        state,
        new Map([[file, code]]),
      );
    } else {
      await refreshGraph(context, state);
    }
    const compiled = state.output.get(file);
    if (compiled === undefined) {
      if (!entries.includes(file)) return null;
      throw new Error(
        `memoized-dom: linked Vite graph omitted managed module ${file}`,
      );
    }
    return { code: compiled, map: null };
  }

  return {
    name: 'memoized-dom',
    enforce: 'pre',
    perEnvironmentWatchChangeDuringDev: true,
    perEnvironmentStartEndDuringDev: true,
    applyToEnvironment(environment) {
      return environment.name === 'client';
    },
    configResolved(resolved) {
      config = resolved;
      entries = entryFiles(resolved.root, options.entries);
    },
    async buildStart() {
      await refreshGraph(
        this as AdapterTransformContext,
        stateFor(this.environment),
      );
    },
    transform: {
      filter: { id: sourceId },
      handler(code, id) {
        return transformModule(this, code, id);
      },
    },
    async hotUpdate(update) {
      const state = states.get(this.environment);
      const file = normalizeFile(update.file);
      if (state === undefined || !state.files.has(file)) return;
      const previous = new Map(state.output);
      const overrides =
        update.type === 'delete'
          ? new Map<string, string>()
          : new Map([[file, await update.read()]]);
      await refreshGraph(
        hotGraphContext(this.environment, this),
        state,
        overrides,
      );
      const changed = new Set<string>();
      for (const candidate of new Set([
        ...previous.keys(),
        ...state.output.keys(),
      ])) {
        if (previous.get(candidate) !== state.output.get(candidate)) {
          changed.add(candidate);
        }
      }
      return invalidateManagedModules(
        this.environment,
        changed,
        update.timestamp,
      );
    },
  };
}
