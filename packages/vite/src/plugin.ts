/**
 * Vite 8 plugin backed by connected compiler graphs and live module HMR.
 */
import { dirname, join, relative, resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import remapping from '@jridgewell/remapping';
import type { CompilerSourceMap } from '@memoized-dom/compiler';
import type {
  DevEnvironment,
  MinimalPluginContextWithoutEnvironment,
  Plugin,
  ResolvedConfig,
} from 'vite';
import type { GraphPluginContext } from './graph/collector';
import { compileGraph } from './graph/collector';
import { writeRoutesDeclaration } from './routes';
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
import { hydrationBootstrap, hydrationVirtualId, resolvedHydrationVirtualId } from './hydration';
import { applyInitialPage } from './initial-html';
import { initialBootstrapDescriptor } from '@memoized-dom/runtime/server';
import { registerClientStyles } from './dev-assets';
import {
  applicationVirtualId, integrationVirtualId, productionEntryVirtualId,
  resolvedApplicationVirtualId, resolvedIntegrationVirtualId, resolvedProductionEntryVirtualId,
  applicationModule, configureDevelopmentDelivery, developmentIntegrationModule,
  productionIntegrationModule, integratedServerImports, relocateClientRoot,
  nodeProductionEntry, bunProductionEntry,
  type FullstackPluginApi, type ProductionDelivery,
} from './fullstack';
import {
  generateServerFunctionRoutesModule,
  isServerFunctionFile,
  isServerFunctionImplementation,
  serverFunctionImplementationSource,
  resolvedServerFunctionsClientVirtualId,
  resolvedServerFunctionsVirtualId,
  type ServerFunctionBarrelEntry,
  serverFunctionsClientVirtualId,
  serverFunctionsVirtualId,
  writeServerFunctionDeclarations,
} from './server-functions';
import {
  isServerConfigFile,
  resolveServerAlias,
  writeServerConfigDeclaration,
} from './server-config';

const sourceId = /(?:\.[jt]sx?|\.tsrx)(?:$|[?#])/;
const statefulRuntimePackages = [
  '@memoized-dom/runtime',
  '@memoized-dom/data',
  '@memoized-dom/router',
];

interface AdapterTransformContext extends GraphPluginContext {
  environment: { name: string };
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
  let devServer: import('vite').ViteDevServer | undefined;
  let entries: readonly string[] = [];
  let serverFunctionRoutesSource =
    'export const serverFunctionManifest = [];\nexport const serverFunctionRoutes = [];\n';
  let serverFunctionClientBarrelSource = '';
  let serverFunctionBarrelEntries: readonly ServerFunctionBarrelEntry[] = [];
  let productionDelivery: ProductionDelivery | undefined;
  const api: FullstackPluginApi = {
    runtime: options.runtime ?? 'bun',
    get serverEntry() {
      return options.serverEntry === undefined || config === undefined ? options.serverEntry : resolve(config.root, options.serverEntry);
    },
    nativeDevelopment: false,
  };

  async function assetFiles(directory: string, prefix = ''): Promise<string[]> {
    const files: string[] = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory()) files.push(...await assetFiles(join(directory, item.name), name + '/'));
      else if (item.isFile()) files.push(name);
    }
    return files;
  }

  async function refreshServerFunctions(): Promise<readonly string[]> {
    if (config === undefined) return [];
    const generated = await generateServerFunctionRoutesModule(
      config.root,
      options,
    );
    serverFunctionRoutesSource = generated.source;
    serverFunctionClientBarrelSource = generated.clientBarrelSource;
    serverFunctionBarrelEntries = generated.clientBarrelEntries;
    await writeServerFunctionDeclarations(config.root, generated.modules, options);
    return generated.files;
  }

  async function refreshServerConfig(): Promise<string | null> {
    if (config === undefined) return null;
    return writeServerConfigDeclaration(config.root, options);
  }

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

  async function pageDocuments(environmentName: string): Promise<readonly { filename: string; html: string }[]> {
    if (!config || config.command !== 'build' || environmentName === 'ssr' || config.build.lib) return [];
    const input = config.build.rollupOptions.input ?? resolve(config.root, 'index.html');
    const files = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input);
    return Promise.all(files.filter(file => file.endsWith('.html')).map(async file => {
      const filename = normalizeFile(resolve(config!.root, file));
      return { filename, html: await readFile(filename, 'utf8') };
    }));
  }

  async function refreshGraph(
    context: GraphPluginContext,
    state: AdapterState,
    overrides: ReadonlyMap<string, string> = new Map(),
    environmentName = 'client',
  ): Promise<void> {
    const graphConfig = config;
    if (graphConfig === undefined) {
      throw new Error(
        'memoized-dom: Vite graph compilation started before config resolution',
      );
    }
    if (state.compiling === undefined) {
      state.compiling = pageDocuments(environmentName).then(documents => compileGraph(
        graphContext(context),
        graphConfig.root,
        entries,
        options,
        overrides,
        options.target !== 'desktop' && graphConfig.command === 'serve' && environmentName !== 'ssr',
        true,
        serverFunctionBarrelEntries,
        environmentName === 'ssr' ? 'server' : 'client',
        documents,
      ));
    }
    const compilation = state.compiling;
    try {
      const graph = await compilation;
      state.replace(graph);
      await writeRoutesDeclaration(graphConfig.root, graph.routes);
      if (devServer !== undefined && environmentName !== 'ssr') {
        registerClientStyles(devServer, state, state.eagerStyles, state.routeStyles, state.routeTree);
      }
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
    environmentName = 'client',
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
        options.target !== 'desktop' && config.command === 'serve' && environmentName !== 'ssr',
        false,
        serverFunctionBarrelEntries,
        environmentName === 'ssr' ? 'server' : 'client',
      );
    }
    const compilation = state.compiling;
    try {
      state.replace(await compilation);
      if (devServer !== undefined && environmentName !== 'ssr') {
        registerClientStyles(devServer, state, state.eagerStyles, state.routeStyles, state.routeTree);
      }
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

  function clientEntryCode(
    file: string,
    code: string,
    environment: { name: string },
  ): string {
    if (
      options.serverEntry === undefined ||
      environment.name === 'ssr' ||
      stateFor(environment).initialPage !== undefined ||
      !entries.includes(file)
    ) return code;
    // Fullstack entries mount over server markup: append the side-effect
    // import that installs the hydration runtime. Appending after the
    // compiled body keeps existing sourcemap lines exact.
    return `${code}\nimport ${JSON.stringify(config?.command === 'build' ? hydrationVirtualId : '@memoized-dom/runtime/hydrate')};\n`;
  }

  async function transformModule(
    context: AdapterTransformContext,
    code: string,
    id: string,
  ): Promise<{ code: string; map: CompilerSourceMap } | null> {
    if (
      config === undefined ||
      !sourceId.test(id) ||
      id.includes('?memo-style.css') ||
      isServerFunctionImplementation(id)
    ) return null;
    const file = cleanViteId(id);
    const state = stateFor(context.environment);
    let managed = entries.includes(file) || state.files.has(file);

    // The SSR environment also loads the application's ordinary server
    // entry and its implementation modules. Plain .ts/.js files outside the
    // connected browser entry graph are server code, not UI compiler roots.
    // JSX/TSRX files remain eligible for on-demand SSR compilation.
    if (
      context.environment.name === 'ssr' &&
      !managed &&
      /\.[jt]s$/.test(file)
    ) return null;

    if (context.environment.name === 'ssr' && config.command === 'serve' && state.output.size === 0) {
      await refreshGraph(context, state, new Map([[file, code]]), 'ssr');
      managed = entries.includes(file) || state.files.has(file);
    }

    const cached = managed ? state.output.get(file) : undefined;
    if (cached !== undefined) {
      return {
        code: clientEntryCode(file, cached, context.environment),
        map: state.maps.get(file)!,
      };
    }

    if (managed) {
      if (state.compiling === undefined) {
        await refreshGraph(
          context,
          state,
          new Map([[file, code]]),
          context.environment.name,
        );
      } else {
        await refreshGraph(context, state, new Map(), context.environment.name);
      }
      const compiled = state.output.get(file);
      if (compiled === undefined) {
        if (!entries.includes(file)) return null;
        throw new Error(
          `memoized-dom: linked Vite graph omitted managed module ${file}`,
        );
      }
      return {
        code: clientEntryCode(file, compiled, context.environment),
        map: state.maps.get(file)!,
      };
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
        config.command === 'serve' && context.environment.name !== 'ssr',
        false,
        serverFunctionBarrelEntries,
        context.environment.name === 'ssr' ? 'server' : 'client',
      );
    }
    const compilation = lazy.compiling;
    try {
      lazy.replace(await compilation);
      if (devServer !== undefined && context.environment.name !== 'ssr') {
        registerClientStyles(devServer, lazy, lazy.eagerStyles, lazy.routeStyles, lazy.routeTree);
      }
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
    api,
    config(userConfig) {
      // These packages intentionally share realm/runtime state across public
      // subpath entries (`data` + `data/internal`, and router internals).
      // Prebundling deep imports as independent optimized entries duplicates
      // that state and can hide a registered root from mount(). Let Vite serve their emitted
      // ESM chunks directly so every subpath converges on one module record.
      return {
        ...(options.serverEntry === undefined ? {} : { appType: 'custom' as const }),
        ...(options.serverEntry === undefined || userConfig.build?.ssr ? {} : {
          builder: { sharedPlugins: true, ...(options.runtime === 'cloudflare' ? { buildApp: async () => {} } : {}) },
          environments: {
            client: { build: { outDir: 'dist/client' } },
            ...(options.runtime === 'cloudflare' ? {} : {
              ssr: { resolve: { noExternal: ['@memoized-dom/adapters'] },
                build: { outDir: 'dist', ssr: true, copyPublicDir: false, emptyOutDir: false,
                rollupOptions: { input: productionEntryVirtualId, output: { entryFileNames: 'server.js' } } } },
            }),
          },
        }),
        optimizeDeps: {
          exclude: statefulRuntimePackages,
        },
      };
    },
    configEnvironment(name) {
      if (name !== 'client' && name !== 'ssr') return;
      return {
        optimizeDeps: {
          exclude: statefulRuntimePackages,
          // Scan uncompiled JSX without synthesizing a React runtime import.
          rolldownOptions: { transform: { jsx: 'preserve' as const } },
        },
      };
    },
    perEnvironmentWatchChangeDuringDev: true,
    perEnvironmentStartEndDuringDev: true,
    applyToEnvironment(environment) {
      return environment.name === 'client' || environment.name === 'ssr';
    },
    configResolved(resolved) {
      config = resolved;
      entries = entryFiles(resolved.root, options.entries);
      if (options.runtime === 'cloudflare' && !resolved.plugins.some(plugin => plugin.name === 'memoized-dom:cloudflare')) {
        throw new Error('memoized-dom: the Cloudflare target requires cloudflare() from @memoized-dom/vite/cloudflare');
      }
    },
    configureServer(server) {
      devServer = server;
      for (const [environment, state] of states) {
        if ((environment as { name?: string }).name === 'client') {
          registerClientStyles(server, state, state.eagerStyles, state.routeStyles, state.routeTree);
        }
      }
      if (options.serverEntry !== undefined) configureDevelopmentDelivery(server);
    },
    async buildApp(builder) {
      const client = builder.environments.client;
      if (!client) throw new Error('memoized-dom: missing client build environment');
      if (options.serverEntry === undefined) {
        await builder.build(client);
        return;
      }
      await builder.build(client);
      const ssr = builder.environments.ssr;
      if (!ssr) throw new Error('memoized-dom: missing server build environment');
      const clientDirectory = resolve(client.config.root, client.config.build.outDir);
      const serverDirectory = resolve(ssr.config.root, ssr.config.build.outDir);
      productionDelivery = {
        document: await readFile(join(clientDirectory, 'index.html'), 'utf8'),
        files: await assetFiles(clientDirectory),
        base: client.config.base,
        assetsDir: client.config.build.assetsDir,
        clientRoot: relative(serverDirectory, clientDirectory).replaceAll('\\', '/'),
        runtime: options.runtime ?? 'bun',
        assetsBinding: api.cloudflareAssetsBinding,
      };
      await builder.build(ssr);
    },
    async buildStart() {
      for (const file of await refreshServerFunctions()) this.addWatchFile(file);
      const serverConfig = await refreshServerConfig();
      if (serverConfig !== null) this.addWatchFile(serverConfig);
      // Worker dependency scans start this hook before optimization finishes.
      // Resolve the SSR component graph when its modules are transformed;
      // eagerly resolving dependencies here would wait on the same scan.
      if (config?.command === 'serve' && this.environment.name === 'ssr') return;
      await refreshGraph(
        this as AdapterTransformContext,
        stateFor(this.environment),
        new Map(),
        this.environment.name,
      );
    },
    generateBundle() {
      if (options.target !== 'desktop') return;
      this.emitFile({
        type: 'asset',
        fileName: 'desktop.json',
        source: JSON.stringify({
          version: 1,
          mountTarget: stateFor(this.environment).mountTarget,
        }),
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (config?.command !== 'build') return html;
        for (const [environment, state] of states) {
          if ((environment as { name?: string }).name !== 'client' || !state.initialPage) continue;
          const prepared = applyInitialPage(html, context.filename, config.root,
            state.initialPage, state.eagerStyles, options.serverEntry !== undefined);
          if (prepared === null) throw new Error('memoized-dom: page shell changed after compiler delivery planning');
          if (options.serverEntry !== undefined) {
            if (!state.initialDelivery) throw new Error('memoized-dom: missing compiler delivery identity');
            return prepared + initialBootstrapDescriptor({
              key: state.initialDelivery.key, target: state.initialDelivery.target, browser: state.initialDelivery.browser,
            });
          }
          return prepared;
        }
        return html;
      },
    },
    async resolveId(id, importer) {
      if (id === applicationVirtualId) return resolvedApplicationVirtualId;
      if (id === integrationVirtualId) return resolvedIntegrationVirtualId;
      if (id === productionEntryVirtualId) return resolvedProductionEntryVirtualId;
      if (id === hydrationVirtualId) return resolvedHydrationVirtualId;
      if (id === serverFunctionsVirtualId) {
        return resolvedServerFunctionsVirtualId;
      }
      if (id === serverFunctionsClientVirtualId) {
        return resolvedServerFunctionsClientVirtualId;
      }
      if (id.startsWith('#server/')) {
        if (this.environment.name === 'client') {
          this.error(
            `memoized-dom: server-only module '${id}' cannot be imported by the client graph`,
          );
        }
        if (config === undefined) {
          this.error('memoized-dom: #server resolution started before config');
        }
        const candidate = resolveServerAlias(config.root, id, options);
        return this.resolve(candidate, importer, { skipSelf: true });
      }
      if (isServerFunctionImplementation(id)) return id;
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
    async load(id) {
      if (id === resolvedApplicationVirtualId) return { code: applicationModule(api.runtime), map: { mappings: '' } };
      if (id === resolvedIntegrationVirtualId) {
        return { code: productionDelivery ? productionIntegrationModule(productionDelivery) : developmentIntegrationModule(devServer!, api.runtime, api.cloudflareAssetsBinding), map: { mappings: '' } };
      }
      if (id === resolvedProductionEntryVirtualId) {
        return { code: options.runtime === 'node' ? nodeProductionEntry(api.serverEntry!) : bunProductionEntry(api.serverEntry!), map: { mappings: '' } };
      }
      if (id === resolvedHydrationVirtualId) {
        return { code: hydrationBootstrap(stateFor(this.environment).hydrationCapabilities), map: { mappings: '' } };
      }
      if (isServerFunctionImplementation(id)) {
        if (this.environment.name === 'client') {
          this.error('memoized-dom: server function implementations cannot be imported by the client graph');
        }
        const file = cleanViteId(id);
        this.addWatchFile(file);
        return {
          code: serverFunctionImplementationSource(await readFile(file, 'utf8'), file, config!.root, options),
          map: { mappings: '' },
        };
      }
      if (id === resolvedServerFunctionsVirtualId) {
        if (this.environment.name === 'client') {
          this.error(
            'memoized-dom: virtual:memoized-dom/server-functions is server-only and cannot be imported by the client graph',
          );
        }
        return { code: serverFunctionRoutesSource, map: { mappings: '' } };
      }
      if (id === resolvedServerFunctionsClientVirtualId) {
        return { code: serverFunctionClientBarrelSource, map: { mappings: '' } };
      }
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
      async handler(code, id) {
        const compiled = await transformModule(this, code, id);
        if (this.environment.name !== 'ssr' || (!api.nativeDevelopment && !productionDelivery)) return compiled;
        const integrated = integratedServerImports(compiled?.code ?? code, id);
        if (!integrated) return compiled;
        const map = compiled?.map ? remapping([JSON.parse(integrated.map.toString()), compiled.map], () => null).toString() : integrated.map.toString();
        return { code: integrated.code, map };
      },
    },
    renderChunk(code, chunk) {
      if (!productionDelivery || this.environment.name !== 'ssr') return null;
      return relocateClientRoot(code, chunk.fileName, productionDelivery.clientRoot) ?? null;
    },
    async hotUpdate(update) {
      const file = normalizeFile(update.file);
      const serverFunctionChanged =
        config !== undefined && isServerFunctionFile(config.root, file, options);
      const serverConfigChanged = config !== undefined &&
        isServerConfigFile(config.root, file, options);
      if (serverConfigChanged) await refreshServerConfig();
      let virtualModule = serverFunctionChanged
        ? this.environment.moduleGraph.getModuleById(
            resolvedServerFunctionsVirtualId,
          )
        : undefined;
      const clientBarrelModule = serverFunctionChanged
        ? this.environment.moduleGraph.getModuleById(
            resolvedServerFunctionsClientVirtualId,
          )
        : undefined;
      if (serverFunctionChanged) {
        await refreshServerFunctions();
        for (const module of [virtualModule, clientBarrelModule]) {
          if (module !== undefined) {
            this.environment.moduleGraph.invalidateModule(
              module,
              new Set(),
              update.timestamp,
              true,
            );
          }
        }
      }
      const primary = states.get(this.environment);
      const isPrimary = primary?.files.has(file) === true;
      const state = hotStateFor(this.environment, file);
      if (state === undefined) {
        return virtualModule === undefined ? undefined : [virtualModule];
      }
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
          await refreshGraph(context, state, overrides, this.environment.name);
        } else {
          await refreshLazyGraph(
            context,
            state,
            file,
            overrides,
            this.environment.name,
          );
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
      const modules = invalidateManagedModules(
        this.environment,
        changed,
        update.timestamp,
      );
      if (virtualModule !== undefined && !modules.includes(virtualModule)) {
        modules.push(virtualModule);
      }
      return modules;
    },
  };
}
