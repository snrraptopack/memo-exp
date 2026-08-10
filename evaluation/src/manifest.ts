import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { artifactRoot } from './shared';

const excludedDirectories = new Set(['node_modules', 'release', 'tmp']);
const excludedFiles = new Set(['MANIFEST.sha256']);

async function filesBelow(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile() && !excludedFiles.has(entry.name)) files.push(path);
  }
  return files;
}

const lines: string[] = [];
for (const path of (await filesBelow(artifactRoot)).sort()) {
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  const name = relative(artifactRoot, path).replaceAll('\\', '/');
  lines.push(`${digest}  ${name}`);
}
await writeFile(join(artifactRoot, 'MANIFEST.sha256'), `${lines.join('\n')}\n`);
console.log(`wrote ${lines.length} checksums to MANIFEST.sha256`);
