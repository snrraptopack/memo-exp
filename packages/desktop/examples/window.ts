/** Compile authored behavior and connect it to the native GPUI window process. */
import { resolve } from 'node:path';
import { createDesktopApplication, runDesktopEntry, type SceneSnapshot } from '@memoized-dom/desktop';
import { createProcessHost } from '@memoized-dom/desktop/host';
import { buildDesktopEntry } from '@memoized-dom/desktop/dev';

const entry = process.argv.find(arg => arg.startsWith('--entry='))?.slice(8) ?? resolve(import.meta.dirname, 'counter/main.ts');
const code = await buildDesktopEntry(entry);
const executable = resolve(import.meta.dirname, '../rust/gpui/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-window.exe' : 'memoized-dom-desktop-window');
const host = createProcessHost({ executable, window: true });
const app = createDesktopApplication(host);
let events = Promise.resolve();
const unsubscribe = host.onEvent(event => {
  events = events.then(async () => { await app.dispatch(event.handle, event.site, event.payload); })
    .catch(error => { console.error('Desktop event failed:', error); });
});
async function waitForFrame(sequence: number, afterFrame = -1): Promise<SceneSnapshot> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const snapshot = await host.inspect();
    if (snapshot.renderer?.error) throw new Error(snapshot.renderer.error);
    if (snapshot.renderer && snapshot.renderer.sequence >= sequence && snapshot.renderer.frames > afterFrame) return snapshot;
    await Bun.sleep(25);
  }
  throw new Error('Desktop window did not paint the accepted scene');
}
try {
  await host.ready;
  const roots = await runDesktopEntry(app, () => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
  const counter = roots.get('root')!;
  if (process.argv.includes('--smoke')) {
    const initial = await waitForFrame(1);
    if (!initial.renderer || initial.renderer.width <= 0 || initial.renderer.height <= 0) throw new Error('Desktop layout has empty bounds');
    const buttons = initial.renderer.boxes.filter(box => box.tag === 'button');
    if (buttons.length !== 2 || Math.abs(buttons[0]!.y - buttons[1]!.y) > 1 || buttons[1]!.x <= buttons[0]!.x + buttons[0]!.width) throw new Error('Authored flex CSS did not arrange the buttons in a row with a gap');
    const card = initial.renderer.boxes.find(box => box.id === 'app');
    if (!card || card.width > 721 || card.width < 600) throw new Error('Authored width/max-width CSS was not applied');
    const tileA = initial.renderer.boxes.find(box => box.id === 'tile-a');
    const tileB = initial.renderer.boxes.find(box => box.id === 'tile-b');
    if (!tileA || !tileB || Math.abs(tileA.width - tileB.width) > 1 || Math.abs(tileA.y - tileB.y) > 1 || tileB.x <= tileA.x + tileA.width) throw new Error('Authored grid CSS did not create equal columns with a gap');
    const wide = initial.renderer.boxes.find(box => box.id === 'wrap-wide');
    const narrow = initial.renderer.boxes.find(box => box.id === 'wrap-narrow');
    if (!wide || !narrow || wide.width <= narrow.width || narrow.height <= wide.height) throw new Error('CSS width constraints did not change native paragraph wrapping');
    await counter.dispatch(0);
    const updated = await waitForFrame(2);
    if (!updated.instances[0]?.text_groups.some(group => group.text === 'Count: 1')) throw new Error('Desktop counter was not updated');
    await host.redraw();
    const redrawn = await waitForFrame(2, updated.renderer!.frames);
    if (redrawn.renderer!.shaping !== updated.renderer!.shaping) throw new Error('Unchanged native text was reshaped');
    console.log('GPUI TSX/CSS window smoke test passed:', JSON.stringify({ frames: redrawn.renderer!.frames, shaping: redrawn.renderer!.shaping, boxes: redrawn.renderer!.boxes.length }));
  } else {
    console.log(`Desktop window is ready. Edit ${entry} and its TSX/CSS imports. Buttons support clicks and Tab/Enter/Space.`);
    await host.windowClosed;
  }
} finally {
  unsubscribe();
  await events;
  try { await app.dispose(); } finally { await host.close(); }
}
