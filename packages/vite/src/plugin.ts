/**
 * Vite 8 plugin backed by connected compiler graphs and live module HMR.
 */
import { dirname, join } from 'node:path';
import type { CompilerSourceMap } from '@memoized-dom/compiler';
import type {
  DevEnvironment,
  MinimalPluginContextWithoutEnvironment,
  Plugin,
  ResolvedConfig,
} from 'vite';
import type { GraphPluginContext } from './graph/collector';
import { compileGraph } from './graph/collector';
import { invalidateManagedModules } from './hmr';
import {
  resolveAdapterOptions,
  type MemoizedDomViteOptions,
} from './options';
import {
  acceptsSource,
  cleanViteId,
  entryFiles,
  normalizeFile,
} from './paths';
import { AdapterState } from './state';

const sourceId = /(?:\.[jt]sx?|\.tsrx)(?:$|[?#])/;

interface AdapterTransformContext extends GraphPluginContext {
  environment: object;
}

export function memoizedDom(
  input: MemoizedDomViteOptions,
): Plugin {
  const options = resolveAdapterOptions(input);
  const states = new Map<object, AdapterState>();
  // Secondary graphs compiled on demand for files outside the primary entry
  // graph (e.g. visiting /hacker-news/ while the primary graph is the
  // workspace example). Keyed by the requested source file.
  const lazyStates = new Map<object, Map<string, AdapterState>>();
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

  async function refreshLazyGraph(
    context: GraphPluginContext,
    state: AdapterState,
    file: string,
    overrides: ReadonlyMap<string, string> = new Map(),
  ): Promise<void> {
    if (config === undefined) {
      throw new Error(
        'memoized-dom: Vite graph compilation started before config resolution',
      );
    }
    const entry = state.entry ?? file;
    if (state.compiling === undefined) {
      state.compiling = compileGraph(
        graphContext(context),
        config.root,
        [entry],
        options,
        overrides,
        config.command === 'serve',
        false,
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

  function lazyStateContaining(
    environment: object,
    file: string,
  ): AdapterState | undefined {
    const perFile = lazyStates.get(environment);
    if (perFile === undefined) return undefined;
    const direct = perFile.get(file);
    if (direct !== undefined && (direct.files.has(file) || direct.css.has(file))) return direct;
    for (const state of perFile.values()) {
      if (state.files.has(file) || state.css.has(file)) return state;
    }
    return undefined;
  }

  function hotStateFor(
    environment: object,
    file: string,
  ): AdapterState | undefined {
    const primary = states.get(environment);
    if (primary !== undefined && (primary.files.has(file) || primary.css.has(file))) return primary;
    return lazyStateContaining(environment, file);
  }

  async function finishPendingCompilation(state: AdapterState): Promise<void> {
    const pending = state.compiling;
    if (pending === undefined) return;
    try {
      await pending;
    } catch {
      // The update that owns this compilation reports its own error. A newer
      // edit must compile again with its own source instead of inheriting the
      // stale rejection.
    } finally {
      if (state.compiling === pending) state.compiling = undefined;
    }
  }

  function lazyStatesFor(environment: object): Map<string, AdapterState> {
    let perFile = lazyStates.get(environment);
    if (perFile === undefined) {
      perFile = new Map<string, AdapterState>();
      lazyStates.set(environment, perFile);
    }
    return perFile;
  }

  async function transformModule(
    context: AdapterTransformContext,
    code: string,
    id: string,
  ): Promise<{ code: string; map: CompilerSourceMap } | null> {
    if (config === undefined || !sourceId.test(id) || id.includes('?memo-style.css')) return null;
    const file = cleanViteId(id);
    const state = stateFor(context.environment);
    const managed = entries.includes(file) || state.files.has(file);

    const cached = managed ? state.output.get(file) : undefined;
    if (cached !== undefined) {
      return { code: cached, map: state.maps.get(file)! };
    }

    if (managed) {
      if (state.compiling === undefined) {
        await refreshGraph(context, state, new Map([[file, code]]));
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
      return { code: compiled, map: state.maps.get(file)! };
    }

    // Outside the primary graph: compile a mount-less graph rooted at the
    // requested file so directly visited example pages work regardless of
    // which graph MMD_EXAMPLE selected.
    if (!acceptsSource(config.root, file, options)) return null;
    const perFile = lazyStatesFor(context.environment);
    let lazy = lazyStateContaining(context.environment, file);
    if (lazy === undefined) {
      lazy = new AdapterState();
      lazy.entry = file;
      perFile.set(file, lazy);
    }
    const lazyCached = lazy.output.get(file);
    if (lazyCached !== undefined) {
      return { code: lazyCached, map: lazy.maps.get(file)! };
    }
    if (lazy.compiling === undefined) {
      lazy.compiling = compileGraph(
        graphContext(context),
        config.root,
        [file],
        options,
        new Map([[file, code]]),
        config.command === 'serve',
        false,
      );
    }
    const compilation = lazy.compiling;
    try {
      lazy.replace(await compilation);
    } finally {
      if (lazy.compiling === compilation) {
        lazy.compiling = undefined;
      }
    }
    const lazyCompiled = lazy.output.get(file);
    if (lazyCompiled === undefined) return null;
    return { code: lazyCompiled, map: lazy.maps.get(file)! };
  }

  return {
    name: 'memoized-dom',
    enforce: 'pre',
    perEnvironmentWatchChangeDuringDev: true,
    perEnvironmentStartEndDuringDev: true,
    applyToEnvironment(environment) {
      return environment.name === 'client' || environment.name === 'ssr';
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
    resolveId(id, importer) {
      if (id.includes('?memo-style.css')) {
        if (importer) {
          const queryIndex = id.indexOf('?');
          const rawSpecifier = id.slice(0, queryIndex);
          const query = id.slice(queryIndex);
          const cleanImporter = cleanViteId(importer);
          const dir = dirname(cleanImporter);
          const resolvedPath = normalizeFile(join(dir, rawSpecifier));
          return `${resolvedPath}${query}`;
        }
        const queryIndex = id.indexOf('?');
        const query = queryIndex === -1 ? '' : id.slice(queryIndex);
        return `${normalizeFile(cleanViteId(id))}${query}`;
      }
      return null;
    },
    load(id) {
      if (id.includes('?memo-style.css')) {
        const clean = normalizeFile(cleanViteId(id));
        const state = hotStateFor(this.environment, clean);
        const style = state?.css.get(clean);
        if (style !== undefined) {
          return { code: style, map: { mappings: '' } };
        }
      }
      return null;
    },
    transform: {
      filter: { id: sourceId },
      handler(code, id) {
        return transformModule(this, code, id);
      },
    },
    async hotUpdate(update) {
      const file = normalizeFile(update.file);
      const primary = states.get(this.environment);
      const isPrimary = primary?.files.has(file) === true;
      const state = hotStateFor(this.environment, file);
      if (state === undefined) return;
      const previous = new Map(state.output);
      const previousCss = new Map(state.css);
      const overrides =
        update.type === 'delete'
          ? new Map<string, string>()
          : new Map([[file, await update.read()]]);
      const context = hotGraphContext(this.environment, this);
      await finishPendingCompilation(state);
      try {
        if (isPrimary) {
          await refreshGraph(context, state, overrides);
        } else {
          await refreshLazyGraph(context, state, file, overrides);
        }
      } catch (error) {
        state.hotUpdateFailed = true;
        throw error;
      }
      const changed = new Set<string>();
      for (const candidate of new Set([
        ...previous.keys(),
        ...state.output.keys(),
      ])) {
        if (previous.get(candidate) !== state.output.get(candidate)) {
          changed.add(candidate);
        }
      }
      for (const candidate of new Set([
        ...previousCss.keys(),
        ...state.css.keys(),
      ])) {
        if (previousCss.get(candidate) !== state.css.get(candidate)) {
          changed.add(candidate);
        }
      }
      if (state.hotUpdateFailed) {
        // A repaired edit can compile to the same output as the last good
        // graph. It still needs one HMR update so Vite clears its error
        // overlay and resumes the client update pipeline.
        changed.add(file);
        state.hotUpdateFailed = false;
      }
      return invalidateManagedModules(
        this.environment,
        changed,
        update.timestamp,
      );
    },
  };
}
