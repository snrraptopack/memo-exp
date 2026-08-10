import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import type { CorpusDescriptor } from './contracts';

export const artifactRoot = resolve(import.meta.dir, '..');
export const corpusRoot = join(artifactRoot, 'corpus');
export const resultsRoot = join(artifactRoot, 'results');

export interface CorpusProgram {
  descriptor: CorpusDescriptor;
  directory: string;
  modules: Record<string, string>;
}

export async function loadCorpus(): Promise<CorpusProgram[]> {
  const names = (await readdir(corpusRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map(loadProgram));
}

async function loadProgram(name: string): Promise<CorpusProgram> {
  const directory = join(corpusRoot, name);
  const descriptor = JSON.parse(
    await readFile(join(directory, 'corpus.json'), 'utf8'),
  ) as CorpusDescriptor;
  const modules: Record<string, string> = {};
  for (const file of (await readdir(directory)).sort()) {
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(extname(file))) continue;
    modules[`./${file.replaceAll('\\', '/')}`] = await readFile(
      join(directory, file),
      'utf8',
    );
  }
  return { descriptor, directory, modules };
}

export function sourceLoc(modules: Record<string, string>): number {
  return Object.values(modules).reduce(
    (total, source) =>
      total +
      source
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('//')).length,
    0,
  );
}

export function resolveModuleId(
  importer: string,
  specifier: string,
  modules: Readonly<Record<string, string>>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const normalized = importer.startsWith('./') && !base.startsWith('../')
    ? `./${base}`
    : base;
  for (const candidate of [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
  ]) {
    if (candidate in modules) return candidate;
  }
  return undefined;
}

export async function writeResult(name: string, contents: string): Promise<void> {
  await mkdir(resultsRoot, { recursive: true });
  await writeFile(join(resultsRoot, name), contents);
}

export function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function relativeToArtifact(path: string): string {
  return relative(artifactRoot, path).replaceAll('\\', '/');
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}
