/**
 * Normalizes Vite ids and bounds which local files enter compiler analysis.
 */
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { ResolvedAdapterOptions } from './options';

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

export function cleanViteId(id: string): string {
  const query = id.search(/[?#]/);
  return normalizeFile(query === -1 ? id : id.slice(0, query));
}

export function normalizeFile(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

export function entryFiles(
  root: string,
  entries: readonly string[],
): readonly string[] {
  return entries.map((entry) => {
    if (isAbsolute(entry)) return normalizeFile(entry);
    const rootRelative = entry.startsWith('/') ? entry.slice(1) : entry;
    return normalizeFile(resolve(root, rootRelative));
  });
}

export function moduleId(root: string, file: string): string {
  const projectRelative = relative(root, file).split(sep).join('/');
  if (
    projectRelative !== '..' &&
    !projectRelative.startsWith('../') &&
    !isAbsolute(projectRelative)
  ) {
    return `./${projectRelative}`;
  }
  return normalizeFile(file);
}

function matches(patterns: RegExp | readonly RegExp[] | undefined, id: string) {
  if (patterns === undefined) return false;
  const list = patterns instanceof RegExp ? [patterns] : patterns;
  return list.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(id);
  });
}

export function acceptsSource(
  root: string,
  file: string,
  options: ResolvedAdapterOptions,
): boolean {
  const id = normalizeFile(file);
  if (!sourceExtensions.has(extname(id))) return false;
  if (id.includes('/node_modules/')) return false;
  if (matches(options.exclude, id)) return false;
  if (matches(options.include, id)) return true;

  const projectRelative = relative(root, id);
  return (
    projectRelative !== '..' &&
    !projectRelative.startsWith(`..${sep}`) &&
    !isAbsolute(projectRelative)
  );
}

export function parserLanguage(
  file: string,
): 'js' | 'jsx' | 'ts' | 'tsx' {
  const extension = extname(file);
  if (extension === '.tsx') return 'tsx';
  if (extension === '.ts') return 'ts';
  if (extension === '.jsx') return 'jsx';
  return 'js';
}
