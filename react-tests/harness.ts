/** Compile authored fixture files and selected package graphs with the public linker. */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModules } from '../packages/compiler/src/linker';

export const here = dirname(fileURLToPath(import.meta.url));
export const fixtureRoot = join(here, 'fixture');
const repositoryRoot = dirname(here);
const requireFromFixture = createRequire(join(fixtureRoot, 'index.ts'));
const extensions = ['.tsx', '.ts', '.jsx', '.mjs', '.js'];

function reactSpecifier(specifier: string): boolean {
  return specifier === 'react' || specifier.startsWith('react/') ||
    specifier === 'react-dom' || specifier.startsWith('react-dom/');
}

function importedSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/(?:import|export)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    found.add(match[1]!);
  }
  for (const match of source.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.add(match[1]!);
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(match[1]!);
  return [...found];
}

export interface FixtureOptions {
  entries: readonly string[];
  /** Local fixture package names or installed npm packages to compile. */
  packages?: readonly string[];
  outDir?: string;
}

export class FixtureGraph {
  readonly modules: Record<string, string> = {};
  readonly outDir: string;
  private readonly virtualFiles = new Map<string, string>();

  constructor(private readonly packages: readonly string[], outDir = 'out') {
    this.outDir = join(here, outDir);
  }

  private localFile(base: string): string | undefined {
    for (const candidate of [base, ...extensions.map((ext) => base + ext),
      ...extensions.map((ext) => join(base, `index${ext}`))]) {
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* try next */ }
    }
    return undefined;
  }

  resolveImport = (specifier: string, importer: string): string | undefined => {
    if (reactSpecifier(specifier)) return undefined;
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
      const importerFile = this.virtualFiles.get(importer) ?? importer;
      const file = this.localFile(resolve(dirname(importerFile), specifier));
      if (file === undefined) return undefined;
      const localId = relative(fixtureRoot, file).replaceAll('\\', '/');
      if (this.packages.some((name) => localId.startsWith(`${name}/`))) {
        this.virtualFiles.set(localId, file);
        return localId;
      }
      return file;
    }
    if (this.packages.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
      const local = this.localFile(join(fixtureRoot, specifier));
      if (local !== undefined) {
        const id = relative(fixtureRoot, local).replaceAll('\\', '/');
        this.virtualFiles.set(id, local);
        return id;
      }
      try { return fileURLToPath(import.meta.resolve(specifier)); } catch {
        try { return requireFromFixture.resolve(specifier); } catch { return undefined; }
      }
    }
    return undefined;
  };

  private selectedPackageFile(id: string): boolean {
    const normalized = id.replaceAll('\\', '/');
    const marker = '/node_modules/';
    const index = normalized.lastIndexOf(marker);
    if (index < 0) return true;
    const parts = normalized.slice(index + marker.length).split('/');
    const packageName = parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
    return this.packages.includes(packageName);
  }

  collect(entries: readonly string[]): Record<string, string> {
    const queue = [...entries];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id in this.modules) continue;
      const source = readFileSync(this.virtualFiles.get(id) ?? id, 'utf8');
      this.modules[id] = source;
      for (const specifier of importedSpecifiers(source)) {
        const target = this.resolveImport(specifier, id);
        if (target !== undefined && !(target in this.modules) && this.selectedPackageFile(target)) {
          queue.push(target);
        }
      }
    }
    return this.modules;
  }

  emittedPath(id: string): string {
    const file = this.virtualFiles.get(id) ?? id;
    const relativeFile = relative(repositoryRoot, file).replaceAll('\\', '/');
    const safe = relativeFile.startsWith('..')
      ? id.replaceAll('\\', '/').replace(/^.*\/node_modules\//, 'node_modules/')
      : relativeFile;
    return join(this.outDir, safe.slice(0, -extname(safe).length) + '.js');
  }

  emit(output: Record<string, string>): Map<string, string> {
    const paths = new Map(Object.keys(output).map((id) => [id, this.emittedPath(id)]));
    for (const [id, path] of paths) {
      let code = output[id]!;
      const source = this.modules[id]!;
      for (const specifier of importedSpecifiers(source)) {
        const target = this.resolveImport(specifier, id);
        const targetPath = target === undefined ? undefined : paths.get(target);
        if (targetPath === undefined) continue;
        let rewritten = relative(dirname(path), targetPath).replaceAll('\\', '/');
        if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
        code = code.replaceAll(`'${specifier}'`, `'${rewritten}'`)
          .replaceAll(`"${specifier}"`, `"${rewritten}"`);
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, code);
    }
    return paths;
  }
}

export function compileFixture(options: FixtureOptions): {
  output: Record<string, string>;
  graph: FixtureGraph;
  emitted: Map<string, string>;
} {
  const graph = new FixtureGraph(options.packages ?? [], options.outDir);
  const output = compileModules(graph.collect(options.entries), {
    react: { packages: options.packages ?? [] },
    resolveImport: graph.resolveImport,
  });
  return { output, graph, emitted: graph.emit(output) };
}
