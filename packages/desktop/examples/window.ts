/** Compile authored behavior and connect it to the native GPUI window process. */
import { resolve } from 'node:path';
import { createDesktopApplication, runDesktopEntry, type SceneSnapshot } from '@memoized-dom/desktop';
import { createProcessHost } from '@memoized-dom/desktop/host';
import { buildDesktopEntry } from '@memoized-dom/desktop/dev';

const entry = process.argv.find(arg => arg.startsWith('--entry='))?.slice(8) ?? resolve(import.meta.dirname, 'counter/main.ts');
const code = await buildDesktopEntry(entry);
const executable = resolve(import.meta.dirname, '../rust/gpui/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-window.exe' : 'memoized-dom-desktop-window');
const host = createProcessHost({ executable, window: true, args: process.argv.includes('--smoke') ? ['--smoke'] : [] });
const app = createDesktopApplication(host);
let events = Promise.resolve();
const unsubscribe = host.onEvent(event => {
  events = events.then(async () => {
    try { await app.dispatch(event.handle, event.site, event.payload); }
    finally { await host.acknowledgeEvent(event); }
  })
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
async function waitForInput(source: number, value: string): Promise<SceneSnapshot> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const snapshot = await host.inspect();
    if (snapshot.instances[0]?.texts[source] === value && snapshot.instances[0].text_groups.some(group => group.text === `Typed: ${value}`)) {
      await events;
      return snapshot;
    }
    await Bun.sleep(25);
  }
  throw new Error(`Native input did not publish its callback and dependent text: ${value}`);
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
    const input = redrawn.renderer!.boxes.find(box => box.tag === 'input');
    if (!input || input.width <= 0 || input.height <= 0) throw new Error('Native input has empty layout bounds');
    await Promise.all([host.testInput(counter.handle, input.source, 'insert', '静🙂'), host.testInput(counter.handle, input.source, 'insert', 'café')]);
    await waitForInput(input.source, '静🙂café');
    await host.testInput(counter.handle, input.source, 'backspace');
    await waitForInput(input.source, '静🙂caf');
    await host.testInput(counter.handle, input.source, 'select-all');
    await host.testInput(counter.handle, input.source, 'compose', 'に');
    await events;
    if ((await host.inspect()).instances[0]!.texts[input.source] !== '静🙂caf') throw new Error('IME preedit leaked into authored state');
    await host.testInput(counter.handle, input.source, 'commit', '日本');
    const typed = await waitForInput(input.source, '日本');
    const settled = await waitForFrame(typed.sequence);
    await host.redraw(); const stable = await waitForFrame(typed.sequence, settled.renderer!.frames);
    if (stable.renderer!.shaping !== settled.renderer!.shaping) throw new Error('Unchanged native input text was reshaped');
    console.log('GPUI TSX/CSS/input window smoke test passed:', JSON.stringify({ frames: stable.renderer!.frames, shaping: stable.renderer!.shaping, boxes: stable.renderer!.boxes.length, input: '日本' }));
  } else {
    console.log(`Desktop window is ready. Edit ${entry} and its TSX/CSS imports. Use Tab to focus buttons and the text input; typing updates the echoed value.`);
    await host.windowClosed;
  }
} finally {
  unsubscribe();
  await events;
  try { await app.dispose(); } finally { await host.close(); }
}
