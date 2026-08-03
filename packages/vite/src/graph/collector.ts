/**
 * Collects one Vite-resolved local graph for compileModules().
 */
import { readFile } from 'node:fs/promises';
import {
  compileModulesDetailed,
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
  parserLanguage,
} from '../paths';
import { valueImports, type ParsedProgram } from './imports';

export interface ResolvedImport {
  id: string;
  external?: boolean | 'absolute' | 'relative';
}

export interface GraphPluginContext {
  parse(
    source: string,
    options: { lang: 'js' | 'jsx' | 'ts' | 'tsx' },
  ): ParsedProgram;
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
    const source =
      overrides.get(cleanFile) ?? (await readFile(cleanFile, 'utf8'));
    sources.set(id, source);
    sourceIds.set(cleanFile, id);

    const program = context.parse(source, {
      lang: parserLanguage(cleanFile),
    });
    for (const specifier of valueImports(program)) {
      const resolved = await context.resolve(specifier, cleanFile, {
        skipSelf: true,
      });
      if (resolved === null || resolved.external) continue;

      const target = cleanViteId(resolved.id);
      if (!acceptsSource(root, target, options)) continue;
      resolutions.set(resolutionKey(id, specifier), moduleId(root, target));
      await visit(target);
    }
  }

  for (const entry of entries) {
    if (!acceptsSource(root, entry, options)) {
      throw new Error(
        `memoized-dom: Vite entry is not an accepted source file: ${entry}`,
      );
    }
    await visit(entry);
  }

  const compileOptions = {
    ...(options.runtimePath === undefined
      ? {}
      : { runtimePath: options.runtimePath }),
    ...(hot ? { hot: true } : {}),
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
  if (compiled.applicationRoot === undefined) {
    context.error({
      message:
        'memoized-dom: Vite entry graph must contain one top-level mount(target, Component) call',
    });
  }
  const rootId = compiled.applicationRoot.rootId;
  const output = new Map<string, string>();
  const maps = new Map<string, CompilerSourceMap>();
  for (const [file, id] of sourceIds) {
    const code = compiled.output[id]!;
    output.set(
      file,
      hot && id !== compiled.applicationRoot.mountModuleId
        ? appendHotBoundary(
            code,
            compiled.metadata[id]!,
            id,
            options.runtimePath ?? '@memoized-dom/runtime',
            rootId,
          )
        : code,
    );
    maps.set(file, compiled.maps[id]!);
  }
  return { files: new Set(sourceIds.keys()), output, maps };
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
