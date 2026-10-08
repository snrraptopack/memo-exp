import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { createDesktopApplication, type SceneInstance } from '../src';
import { createProcessHost } from '../src/bridge/process';

const source = `export function Counter() {
  let count: number = 0;
  return <div>
    <p>Count: <span>{count}</span></p>
    <button onClick={() => count++}>Increment</button>
  </div>;
}`;
const { code } = compileDesktop(source, {
  moduleId: 'desktop-counter.tsx',
  runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href,
});
const compiled = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as { Counter(): SceneInstance };
const executable = resolve(import.meta.dirname, '../rust/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-host.exe' : 'memoized-dom-desktop-host');
const host = createProcessHost({ executable });
try {
  const app = createDesktopApplication(host);
  const counter = app.mount(compiled.Counter);
  await counter.ready;
  console.log('Mounted:', JSON.stringify(await host.inspect()));
  await counter.dispatch(0);
  await counter.dispatch(0);
  console.log('Updated:', JSON.stringify(await host.inspect()));
  await app.dispose();
  console.log('Disposed:', JSON.stringify(await host.inspect()));
} finally { await host.close(); }
