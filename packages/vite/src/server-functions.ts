/** Vite-side discovery and virtual modules for named HTTP server functions. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import {
  analyzeServerFunctionModule,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
  type ServerFunctionModule,
} from '@memoized-dom/compiler';
import type { ResolvedAdapterOptions } from './options';
import { normalizeFile } from './paths';
import { serverRoot } from './server-config';

export const serverFunctionsVirtualId = 'virtual:memoized-dom/server-functions';
export const resolvedServerFunctionsVirtualId =
  '\0virtual:memoized-dom/server-functions';
export const serverFunctionsClientVirtualId = '#server-functions';
export const resolvedServerFunctionsClientVirtualId =
  '\0virtual:memoized-dom/server-functions-client';
export const serverFunctionImplementationQuery =
  'memo-server-function-implementation';

const sourceExtensions = new Set(['.ts', '.tsx', '.tsrx', '.js', '.jsx']);

export function serverFunctionsRoot(
  root: string,
  options: ResolvedAdapterOptions,
): string | null {
  return normalizeFile(resolve(serverRoot(root, options), 'functions'));
}

export function isServerFunctionFile(
  root: string,
  file: string,
  options: ResolvedAdapterOptions,
): boolean {
  const directory = serverFunctionsRoot(root, options);
  if (directory === null) return false;
  const clean = normalizeFile(file);
  const fromRoot = relative(directory, clean).replaceAll('\\', '/');
  return sourceExtensions.has(extname(clean)) &&
    !clean.endsWith('.d.ts') &&
    fromRoot !== '..' &&
    !fromRoot.startsWith('../') &&
    !isAbsolute(fromRoot);
}

export function isServerFunctionImplementation(id: string): boolean {
  return id.includes(`?${serverFunctionImplementationQuery}`) ||
    id.includes(`&${serverFunctionImplementationQuery}`);
}

export async function clientServerFunctionSource(
  source: string,
  file: string,
  root: string,
  options: ResolvedAdapterOptions,
): Promise<string> {
  const directory = serverFunctionsRoot(root, options);
  if (directory === null) return source;
  const module = analyzeServerFunctionModule(source, {
    moduleId: normalizeFile(file),
    functionsRoot: relative(root, directory).replaceAll('\\', '/'),
    ...(options.frontend === undefined ? {} : { frontend: options.frontend }),
  });
  return generateServerFunctionClient(module);
}

async function sourceFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const file = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (
        entry.isFile() &&
        sourceExtensions.has(extname(entry.name)) &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(normalizeFile(file));
      }
    }
  };
  await visit(directory);
  return files.sort();
}

interface DiscoveredModule {
  readonly file: string;
  readonly metadata: ServerFunctionModule;
  readonly middlewareFile: boolean;
}

function directoryKey(root: string, file: string): string {
  const value = relative(root, file).replaceAll('\\', '/');
  const slash = value.lastIndexOf('/');
  return slash === -1 ? '' : value.slice(0, slash);
}

function ancestorDirectories(directory: string): string[] {
  if (directory === '') return [''];
  const parts = directory.split('/');
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))];
}

export interface GeneratedServerFunctionModules {
  readonly source: string;
  readonly files: readonly string[];
  readonly modules: readonly ServerFunctionModule[];
  /** Client `#server-functions` re-export barrel over facade modules. */
  readonly clientBarrelSource: string;
  /** Flat exported-name ownership used to rewrite barrel imports per module. */
  readonly clientBarrelEntries: readonly ServerFunctionBarrelEntry[];
}

export interface ServerFunctionBarrelEntry {
  readonly exported: string;
  readonly specifier: string;
}

/**
 * Rewrite `import { x } from '#server-functions'` into per-module facade
 * imports so the compiler links colorless sources directly instead of through
 * an opaque barrel. Unknown names keep the original clause; the runtime
 * barrel virtual module still serves them.
 */
export function rewriteServerFunctionBarrelImports(
  source: string,
  barrelEntries: readonly ServerFunctionBarrelEntry[],
): string {
  if (!source.includes(serverFunctionsClientVirtualId)) return source;
  return source.replace(
    /import\s*\{([^}]+)\}\s*from\s*(['"])#server-functions\2\s*;?/g,
    (match, namesText: string) => {
      const groups = new Map<string, string[]>();
      for (const raw of namesText.split(',')) {
        const name = raw.trim();
        if (name === '') continue;
        const local = name.split(/\s+as\s+/)[0]!.trim();
        const owner = barrelEntries.find(entry => entry.exported === local);
        if (owner === undefined) return match;
        const names = groups.get(owner.specifier) ?? [];
        names.push(name);
        groups.set(owner.specifier, names);
      }
      if (groups.size === 0) return match;
      return [...groups]
        .map(([specifier, names]) =>
          `import { ${names.join(', ')} } from ${JSON.stringify(specifier)};`)
        .join('\n');
    },
  );
}

export async function generateServerFunctionRoutesModule(
  root: string,
  options: ResolvedAdapterOptions,
): Promise<GeneratedServerFunctionModules> {
  const directory = serverFunctionsRoot(root, options);
  if (directory === null) {
    return {
      source: 'export const serverFunctionManifest = [];\nexport const serverFunctionRoutes = [];\n',
      files: [],
      modules: [],
      clientBarrelSource: '',
      clientBarrelEntries: [],
    };
  }
  const discovered: DiscoveredModule[] = [];
  for (const file of await sourceFiles(directory)) {
    const source = await readFile(file, 'utf8');
    const metadata = analyzeServerFunctionModule(source, {
      moduleId: file,
      functionsRoot: relative(root, directory).replaceAll('\\', '/'),
      ...(options.frontend === undefined ? {} : { frontend: options.frontend }),
    });
    const middlewareFile = /(?:^|\/)_middleware\.[^.]+$/.test(file);
    if (middlewareFile && !metadata.middlewareExport) {
      throw new Error(
        `memo-dom: server function middleware '${file}' must export a named 'middleware' array`,
      );
    }
    discovered.push({ file, metadata, middlewareFile });
  }

  const imports = [
    `import { createServerFunctionRoutes as __mmd_create_routes } from ${JSON.stringify('@memoized-dom/server/router')};`,
  ];
  const aliases = new Map<string, string>();
  discovered.forEach((module, index) => {
    const alias = `__mmd_server_${index}`;
    aliases.set(module.file, alias);
    imports.push(
      `import * as ${alias} from ${JSON.stringify(`${module.file}?${serverFunctionImplementationQuery}`)};`,
    );
  });
  const directoryMiddleware = new Map<string, string>();
  for (const module of discovered) {
    if (!module.middlewareFile) continue;
    directoryMiddleware.set(
      directoryKey(directory, module.file),
      `${aliases.get(module.file)!}.middleware`,
    );
  }

  const manifest: Array<{
    id: string;
    method: string;
    path: string;
    parameters: ServerFunctionModule['functions'][number]['parameters'];
  }> = [];
  const definitions: string[] = [];
  for (const module of discovered) {
    if (module.middlewareFile) continue;
    const alias = aliases.get(module.file)!;
    const layers = ancestorDirectories(directoryKey(directory, module.file))
      .map(candidate => directoryMiddleware.get(candidate))
      .filter((value): value is string => value !== undefined);
    if (module.metadata.middlewareExport) layers.push(`${alias}.middleware`);
    for (const fn of module.metadata.functions) {
      const id = `${module.metadata.moduleName}/${fn.exported}`;
      manifest.push({
        id,
        method: fn.method,
        path: fn.path,
        parameters: fn.parameters,
      });
      definitions.push(`{
        id: ${JSON.stringify(id)},
        method: ${JSON.stringify(fn.method)},
        path: ${JSON.stringify(fn.path)},
        parameters: ${JSON.stringify(fn.parameters)},
        middleware: [${layers.map(layer => `...${layer}`).join(', ')}],
        handler: ${alias}[${JSON.stringify(fn.exported)}]
      }`);
    }
  }
  const barrel: string[] = [];
  const barrelEntries: ServerFunctionBarrelEntry[] = [];
  for (const module of discovered) {
    if (module.middlewareFile || module.metadata.functions.length === 0) continue;
    const specifier = `/${relative(root, module.file).replaceAll('\\', '/')}`;
    for (const fn of module.metadata.functions) {
      barrelEntries.push({ exported: fn.exported, specifier });
    }
    barrel.push(
      `export { ${module.metadata.functions.map(fn => fn.exported).join(', ')} } from ${JSON.stringify(specifier)};`,
    );
  }
  return {
    source: `${imports.join('\n')}
export const serverFunctionManifest = ${JSON.stringify(manifest)};
export const serverFunctionRoutes = __mmd_create_routes([
${definitions.join(',\n')}
]);
`,
    files: discovered.map(module => module.file),
    modules: discovered.map(module => module.metadata),
    clientBarrelSource: `${barrel.join('\n')}${barrel.length === 0 ? '' : '\n'}`,
    clientBarrelEntries: barrelEntries,
  };
}

/** Generated declaration barrel location: `<root>/.memoized/server-functions.d.ts`. */
export function serverFunctionsDeclarationFile(root: string): string {
  return resolve(root, '.memoized', 'server-functions.d.ts');
}

/** Type-only specifier from the generated declaration file to a real module. */
export function implementationSpecifier(
  root: string,
  moduleId: string,
): string {
  const declarationDir = dirname(serverFunctionsDeclarationFile(root));
  const clean = normalizeFile(moduleId);
  const withoutExtension = clean.replace(/(?:\.[cm]?[jt]sx?|\.tsrx)$/i, '');
  const specifier = relative(declarationDir, `${withoutExtension}.js`)
    .replaceAll('\\', '/');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

/** Write the `.memoized/server-functions.d.ts` barrel; no-op when unchanged. */
export async function writeServerFunctionDeclarations(
  root: string,
  modules: readonly ServerFunctionModule[],
  options: ResolvedAdapterOptions,
): Promise<void> {
  if (serverFunctionsRoot(root, options) === null) return;
  const file = serverFunctionsDeclarationFile(root);
  const content = generateServerFunctionDeclarations(
    modules.map(module => ({
      ...module,
      moduleId: normalizeFile(module.moduleId),
    })),
    { resolveImplementation: id => implementationSpecifier(root, id) },
  );
  const existing = await readFile(file, 'utf8').catch(() => undefined);
  if (existing === content) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
