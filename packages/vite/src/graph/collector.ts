/**
 * Collects one Vite-resolved local graph for compileModules().
 */
import { readFile } from 'node:fs/promises';
import { compileModules } from '@memoized-dom/compiler';
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
  external?: boolean | 'absolute';
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
}

export interface CompiledGraph {
  files: ReadonlySet<string>;
  output: ReadonlyMap<string, string>;
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

  const compiled = compileModules(Object.fromEntries(sources), {
    ...(options.rootId === undefined ? {} : { rootId: options.rootId }),
    ...(options.runtimePath === undefined
      ? {}
      : { runtimePath: options.runtimePath }),
    resolveImport(specifier, importer) {
      return resolutions.get(resolutionKey(importer, specifier));
    },
  });
  const output = new Map<string, string>();
  for (const [file, id] of sourceIds) {
    output.set(file, compiled[id]!);
  }
  return { files: new Set(sourceIds.keys()), output };
}
