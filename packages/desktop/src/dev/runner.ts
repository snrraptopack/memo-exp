/** Node-compatible launch bookkeeping; runs unchanged under Bun and Node. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const directory = process.argv[2]!;
const executable = process.argv[3]!;
const headless = process.argv.includes('--headless');
const started = performance.now();
const trace = process.env.MEMOIZED_DESKTOP_TRACE === '1';
const engine = await import(pathToFileURL(resolve(directory, 'engine.mjs')).href);
const manifest = JSON.parse(await readFile(resolve(directory, 'desktop.json'), 'utf8'));
const host = engine.openApplication(executable, manifest.mountTarget, headless, trace);
const commands = createInterface({ input: process.stdin });
let revision = 0;
let queued = false;
let replacing = false;
let stopped = false;
let lastEntry: string | undefined;

async function replace() {
  if (stopped) return;
  if (replacing) {
    queued = true;
    return;
  }
  replacing = true;
  try {
    do {
      queued = false;
      const next = JSON.parse(await readFile(resolve(directory, 'desktop.json'), 'utf8'));
      if (next.mountTarget !== manifest.mountTarget) {
        throw new Error('Changing the mount container requires restarting the desktop session');
      }
      const styles = await Promise.all(next.stylesheets.map(async (source: string) => {
        const css = await readFile(resolve(directory, source), 'utf8');
        return { source, css, revision: createHash('sha256').update(css).digest('hex') };
      }));
      const entry = pathToFileURL(resolve(directory, next.entry)).href;
      await host.replace(styles, entry === lastEntry ? undefined : () => import(entry));
      lastEntry = entry;
      revision++;
      console.log(`Desktop root accepted (revision ${revision}, native host reused)`);
      if (trace && revision === 1) {
        console.log(`desktop-startup ${JSON.stringify({ stage: 'javascript_mount_accepted', elapsedMs: performance.now() - started })}`);
      }
    } while (queued && !stopped);
  } finally {
    replacing = false;
  }
}

function stop(error?: unknown) {
  if (stopped) return;
  stopped = true;
  commands.close();
  host.close();
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

host.onClose((error: { code?: string }) => stop(error.code === 'windowClosed' ? undefined : error));
commands.on('line', command => {
  if (command === 'reload') void replace().catch(stop);
});
commands.on('close', () => stop());
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
await replace().catch(stop);
