/**
 * Collects one Vite-resolved local graph for compileModules().
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  compileModulesDetailed,
  memoizedEstreeFrontend,
  parseWithEstreeFrontendOrThrow,
  toCompilerDiagnostic,
  type CompiledModules,
  type CompiledModuleMetadata,
  type CompilerSourceMap,
} from '@memoized-dom/compiler';
import type { ResolvedAdapterOptions } from '../options';
import {
  acceptsSource,
  cleanViteId,
  moduleId,
} from '../paths';
import { valueImports, type ParsedProgram } from './imports';
import {
  clientServerFunctionSource,
  isServerFunctionFile,
  rewriteServerFunctionBarrelImports,
  type ServerFunctionBarrelEntry,
} from '../server-functions';

export interface ResolvedImport {
  id: string;
  external?: boolean | 'absolute' | 'relative';
}

export interface GraphPluginContext {
  resolve(
    specifier: string,
    importer: string,
    options: { skipSelf: true },
  ): Promise<ResolvedImport | null>;
  addWatchFile(file: string): void;
  error(error: {
    message: string;
    id?: string;
    loc?: { line: number; column: number };
  }): never;
}

export interface CompiledGraph {
  files: ReadonlySet<string>;
  output: ReadonlyMap<string, string>;
  maps: ReadonlyMap<string, CompilerSourceMap>;
  css: ReadonlyMap<string, string>;
}

function resolutionKey(importer: string, specifier: string): string {
  return `${importer}\0${specifier}`;
}

export async function compileGraph(
  context: GraphPluginContext,
  root: string,
  entries: readonly string[],
  options: ResolvedAdapterOptions,
  overrides: ReadonlyMap<string, string>,
  hot: boolean,
  requireMount = true,
  serverFunctionBarrelEntries: readonly ServerFunctionBarrelEntry[] = [],
): Promise<CompiledGraph> {
  const sources = new Map<string, string>();
  const sourceIds = new Map<string, string>();
  const resolutions = new Map<string, string>();
  const visiting = new Set<string>();

  async function visit(file: string): Promise<void> {
    const cleanFile = cleanViteId(file);
    if (visiting.has(cleanFile)) return;
    visiting.add(cleanFile);
    context.addWatchFile(cleanFile);

    const id = moduleId(root, cleanFile);
    const authoredSource =
      overrides.get(cleanFile) ?? (await readFile(cleanFile, 'utf8'));
    const authoredProgram = parseWithEstreeFrontendOrThrow(
      options.frontend ?? memoizedEstreeFrontend,
      authoredSource,
      { filename: id, sourceType: 'module' },
    ).program as ParsedProgram;
    const authoredImports = new Map(
      valueImports(authoredProgram).map(reference => [
        reference.specifier,
        reference,
      ]),
    );
    const facadeSource = isServerFunctionFile(root, cleanFile, options)
      ? await clientServerFunctionSource(
          authoredSource,
          cleanFile,
          root,
          options,
        )
      : authoredSource;
    const source = rewriteServerFunctionBarrelImports(
      facadeSource,
      serverFunctionBarrelEntries,
    );
    sources.set(id, source);
    sourceIds.set(cleanFile, id);

    const program = parseWithEstreeFrontendOrThrow(
      options.frontend ?? memoizedEstreeFrontend,
      source,
      { filename: id, sourceType: 'module' },
    ).program as ParsedProgram;
    for (const reference of valueImports(program)) {
      const { specifier } = reference;
      const resolved = await context.resolve(specifier, cleanFile, {
        skipSelf: true,
      });
      if (resolved === null || resolved.external) continue;

      const target = cleanViteId(resolved.id);
      const authored = authoredImports.get(specifier);
      if (
        authored !== undefined &&
        !isServerFunctionFile(root, cleanFile, options) &&
        isServerFunctionFile(root, target, options)
      ) {
        context.error({
          message:
            `memo-dom: [MMD-S003] UI modules cannot import '${specifier}' directly; import named server functions from '#server-functions' so server-only code cannot enter the client graph`,
          id: cleanFile,
          ...(authored.line === undefined || authored.column === undefined
            ? {}
            : {
                loc: {
                  line: authored.line,
                  column: authored.column,
                },
              }),
        });
      }
      if (!acceptsSource(root, target, options)) continue;
      resolutions.set(resolutionKey(id, specifier), moduleId(root, target));
      await visit(target);
    }
  }
  // Entries are graph seeds, not requirements: a deleted or not-yet-created
  // entry must not take the dev server down. The lazy per-file graph layer
  // compiles managed files on demand regardless of seeds. With no existing
  // seed there is no entry graph — return an empty one and skip the mount
  // requirement entirely.
  const seeds: string[] = [];
  for (const entry of entries) {
    if (!acceptsSource(root, entry, options)) {
      throw new Error(
        `memoized-dom: Vite entry is not an accepted source file: ${entry}`,
      );
    }
    if (!existsSync(entry)) continue;
    seeds.push(entry);
  }
  if (seeds.length === 0) {
    return {
      files: new Set(),
      output: new Map(),
      maps: new Map(),
      css: new Map(),
    };
  }
  for (const entry of seeds) {
    await visit(entry);
  }

  const compileOptions = {
    ...(options.frontend === undefined ? {} : { frontend: options.frontend }),
    ...(options.runtimePath === undefined
      ? {}
      : { runtimePath: options.runtimePath }),
    ...(hot ? { hot: true } : {}),
    ...(options.moduleStateCells === undefined
      ? {}
      : { moduleStateCells: options.moduleStateCells }),
    resolveImport(specifier: string, importer: string) {
      return resolutions.get(resolutionKey(importer, specifier));
    },
  };
  let compiled: CompiledModules;
  try {
    compiled = compileModulesDetailed(Object.fromEntries(sources), compileOptions);
  } catch (error) {
    const diagnostic = toCompilerDiagnostic(error, [...sources.keys()]);
    const file =
      diagnostic.moduleId === undefined
        ? undefined
        : [...sourceIds].find(([, id]) => id === diagnostic.moduleId)?.[0];
    context.error({
      message: diagnostic.message,
      ...(file === undefined ? {} : { id: file }),
      ...(diagnostic.line === undefined || diagnostic.column === undefined
        ? {}
        : {
            loc: {
              line: diagnostic.line,
              column: diagnostic.column,
            },
          }),
    });
  }
  if (requireMount && compiled.applicationRoot === undefined) {
    context.error({
      message:
        'memoized-dom: Vite entry graph must contain one top-level mount(target, Component) call',
    });
  }
  const rootId = compiled.applicationRoot?.rootId ?? 'App';
  const mountModuleId = compiled.applicationRoot?.mountModuleId;
  const output = new Map<string, string>();
  const maps = new Map<string, CompilerSourceMap>();
  const css = new Map<string, string>();
  for (const [file, id] of sourceIds) {
    let code = compiled.output[id]!;
    if (compiled.css?.[id]) {
      css.set(file, compiled.css[id]!);
      code = `import ${JSON.stringify(`./${basename(file)}?memo-style.css`)};\n${code}`;
    }
    output.set(
      file,
      hot && mountModuleId !== undefined && id !== mountModuleId
        ? appendHotBoundary(
            code,
            compiled.metadata[id]!,
            id,
            options.hotRuntimePath ??
              `${options.runtimePath ?? '@memoized-dom/runtime'}/hot`,
            rootId,
          )
        : code,
    );
    maps.set(file, compiled.maps[id]!);
  }
  return { files: new Set(sourceIds.keys()), output, maps, css };
}

function appendHotBoundary(
  code: string,
  metadata: CompiledModuleMetadata,
  moduleId: string,
  runtimePath: string,
  rootId: string,
): string {
  const components = new Map(
    metadata.componentExports.map((component) => [component.local, component]),
  );
  const updates = [...components.values()]
    .map(
      (component) =>
        `[${component.local}, updatedModule[${JSON.stringify(component.exported)}], ${
          component.listLightweight
        }]`,
    )
    .join(', ');
  return `${code}\nimport { applyHotUpdate as __memoized_dom_apply_hot_update__, disposeHotModule as __memoized_dom_dispose_hot_module__ } from ${JSON.stringify(
    runtimePath,
  )};\nif (import.meta.hot) {\n  import.meta.hot.dispose(() => __memoized_dom_dispose_hot_module__(${JSON.stringify(
    moduleId,
  )}, ${JSON.stringify(rootId)}));\n  import.meta.hot.accept((updatedModule) => {\n    if (updatedModule) __memoized_dom_apply_hot_update__([${updates}], ${JSON.stringify(
      rootId,
    )});\n  });\n}`;
}
