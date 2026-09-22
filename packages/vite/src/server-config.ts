import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ResolvedAdapterOptions } from './options';
import { normalizeFile } from './paths';

const configExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;

export function serverRoot(
  root: string,
  options: ResolvedAdapterOptions,
): string {
  const configured = options.server ?? 'server';
  return normalizeFile(isAbsolute(configured)
    ? configured
    : resolve(root, configured));
}

export function resolveServerAlias(
  root: string,
  specifier: string,
  options: ResolvedAdapterOptions,
): string {
  const prefix = '#server/';
  if (!specifier.startsWith(prefix)) {
    throw new TypeError(`memo-dom: invalid server alias '${specifier}'`);
  }
  const base = serverRoot(root, options);
  const candidate = normalizeFile(resolve(base, specifier.slice(prefix.length)));
  const fromBase = relative(base, candidate);
  if (
    fromBase === '..' ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  ) {
    throw new TypeError(
      `memo-dom: server alias '${specifier}' escapes the configured server root`,
    );
  }
  return candidate;
}

export function serverConfigSource(
  root: string,
  options: ResolvedAdapterOptions,
): string | null {
  const base = resolve(serverRoot(root, options), 'config', 'index');
  const matches = configExtensions
    .map(extension => normalizeFile(`${base}${extension}`))
    .filter(file => existsSync(file));
  if (matches.length > 1) {
    throw new Error(
      `memo-dom: server config has multiple index files: ${matches.join(', ')}`,
    );
  }
  return matches[0] ?? null;
}

export function isServerConfigFile(
  root: string,
  file: string,
  options: ResolvedAdapterOptions,
): boolean {
  const base = normalizeFile(resolve(serverRoot(root, options), 'config', 'index'));
  const clean = normalizeFile(file);
  return configExtensions.some(extension => clean === `${base}${extension}`);
}

export function serverConfigDeclarationFile(root: string): string {
  return resolve(root, '.memoized', 'server-config.d.ts');
}

function typeSpecifier(root: string, source: string): string {
  const declarationDirectory = dirname(serverConfigDeclarationFile(root));
  const withoutExtension = source.replace(/\.[^.]+$/, '');
  const value = relative(declarationDirectory, withoutExtension)
    .replaceAll('\\', '/');
  return value.startsWith('.') ? value : `./${value}`;
}

export async function writeServerConfigDeclaration(
  root: string,
  options: ResolvedAdapterOptions,
): Promise<string | null> {
  const output = serverConfigDeclarationFile(root);
  const source = serverConfigSource(root, options);
  if (source === null) {
    if (existsSync(output)) await unlink(output);
    return null;
  }
  const content = `import type { ServerTypes as __MemoizedDomServerTypes } from ${JSON.stringify(typeSpecifier(root, source))};

declare module '@memoized-dom/server/router' {
  interface ServerTypeRegistry {
    application: __MemoizedDomServerTypes;
  }
}

declare module '@memoized-dom/router' {
  interface RoutedTypeRegistry {
    application: __MemoizedDomServerTypes;
  }
}

export {};
`;
  const previous = await readFile(output, 'utf8').catch(() => undefined);
  if (previous !== content) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content);
  }
  return source;
}
