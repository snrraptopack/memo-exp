/** Exercise the same authored TSX entry without opening a platform window. */
import { resolve } from 'node:path';
import { createDesktopApplication, runDesktopEntry } from '@memoized-dom/desktop';
import { createProcessHost } from '@memoized-dom/desktop/host';
import { buildDesktopEntry } from '@memoized-dom/desktop/dev';

const code = await buildDesktopEntry(resolve(import.meta.dirname, 'counter/main.ts'));
const executable = resolve(import.meta.dirname, '../rust/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host');
const host = createProcessHost({ executable });
const app = createDesktopApplication(host);
try {
  await runDesktopEntry(app, () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
  const initial = await host.inspect();
  const counter = initial.instances.find(instance => instance.template.endsWith('#App'))!;
  console.log('Mounted:', JSON.stringify(initial));
  await app.dispatch(counter.handle, 0);
  await app.dispatch(counter.handle, 0);
  console.log('Updated:', JSON.stringify(await host.inspect()));
  await app.dispose();
  console.log('Disposed:', JSON.stringify(await host.inspect()));
} finally {
  try { await app.dispose(); } finally { await host.close(); }
}
