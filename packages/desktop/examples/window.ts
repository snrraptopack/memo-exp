/** Compile authored behavior and connect it to the native GPUI window process. */
import { resolve } from 'node:path';
import { createDesktopApplication, runDesktopEntry, type SceneSnapshot } from '@memoized-dom/desktop';
import { createProcessHost } from '@memoized-dom/desktop/host';
import { buildDesktopEntry } from '@memoized-dom/desktop/dev';

const entry = process.argv.find(arg => arg.startsWith('--entry='))?.slice(8) ?? resolve(import.meta.dirname, 'counter/main.ts');
const code = await buildDesktopEntry(entry);
const executable = process.argv.find(arg => arg.startsWith('--executable='))?.slice(13) ?? resolve(import.meta.dirname, '../rust/gpui/target/debug',
  process.platform === 'win32' ? 'memoized-dom-desktop-window.exe' : 'memoized-dom-desktop-window');
const host = createProcessHost({ executable, window: true, args: process.argv.includes('--smoke') ? ['--smoke'] : [] });
const app = createDesktopApplication(host);
let smokeReport: Record<string, unknown> | undefined;
let shutdownMs = 0;
let events = Promise.resolve();
let eventGate = Promise.resolve();
const unsubscribe = host.onEvent(event => {
  events = events.then(async () => {
    await eventGate;
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
    const counter = snapshot.instances.find(instance => instance.template.endsWith('#App'));
    if (counter?.texts[source] === value && counter.text_groups.some(group => group.text === `Typed: ${value}`)) {
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
  const root = roots.get('root')!;
  const counter = (await host.inspect()).instances.find(instance => instance.template.endsWith('#App'))!;
  if (!counter) throw new Error('Authored counter was not mounted');
  if (process.argv.includes('--smoke')) {
    const initial = await waitForFrame(1);
    if (!initial.renderer || initial.renderer.width <= 0 || initial.renderer.height <= 0) throw new Error('Desktop layout has empty bounds');
    const buttons = initial.renderer.boxes.filter(box => box.tag === 'button' && box.handle.id === counter.handle.id);
    if (buttons.length !== 2 || Math.abs(buttons[0]!.y - buttons[1]!.y) > 1 || buttons[1]!.x <= buttons[0]!.x + buttons[0]!.width) throw new Error('Authored flex CSS did not arrange the buttons in a row with a gap');
    const card = initial.renderer.boxes.find(box => box.id === 'app');
    if (!card || card.width > 721 || card.width < 600) throw new Error('Authored width/max-width CSS was not applied');
    const tileA = initial.renderer.boxes.find(box => box.id === 'tile-a');
    const tileB = initial.renderer.boxes.find(box => box.id === 'tile-b');
    if (!tileA || !tileB || Math.abs(tileA.width - tileB.width) > 1 || Math.abs(tileA.y - tileB.y) > 1 || tileB.x <= tileA.x + tileA.width) throw new Error('Authored grid CSS did not create equal columns with a gap');
    const wide = initial.renderer.boxes.find(box => box.id === 'wrap-wide');
    const narrow = initial.renderer.boxes.find(box => box.id === 'wrap-narrow');
    if (!wide || !narrow || wide.width <= narrow.width || narrow.height <= wide.height) throw new Error('CSS width constraints did not change native paragraph wrapping');
    const childCard = initial.renderer.boxes.find(box => box.id === 'child-card');
    if (!childCard || childCard.handle.id === counter.handle.id || !card || childCard.x < card.x || childCard.x + childCard.width > card.x + card.width + 1) throw new Error('Child component was not attached inside its parent layout');
    const child = initial.instances.find(instance => instance.handle.id === childCard.handle.id)!;
    if (child.attach_to?.handle.id !== counter.handle.id || root.handle.id === counter.handle.id || initial.instances.length !== 8) throw new Error('Nested component ownership was not retained');
    const page = initial.renderer.boxes.find(box => box.id === 'desktop-page');
    if (!page || Math.abs(card.x - page.x - 32) > 1) throw new Error('Page padding did not come from authored CSS');
    if (!initial.renderer.scroll || initial.renderer.scroll.max <= 0 || initial.renderer.height <= initial.renderer.scroll.viewport) throw new Error('Content overflow was hidden from the native scroll viewport');
    await host.testWindow({ action: 'scroll', delta: -300 });
    const scrolled = await waitForFrame(initial.sequence, initial.renderer.frames);
    const movedCard = scrolled.renderer!.boxes.find(box => box.id === 'app');
    if (!movedCard || movedCard.y >= card.y || scrolled.renderer!.scroll!.offset >= 0) throw new Error('Native wheel movement did not reveal overflowing content');
    await host.testWindow({ action: 'scroll', delta: -100_000 });
    const bottom = await waitForFrame(initial.sequence, scrolled.renderer!.frames);
    const footer = bottom.renderer!.boxes.find(box => box.tag === 'blockquote' && box.handle.id === counter.handle.id);
    if (!footer || footer.y < 0 || footer.y + footer.height > bottom.renderer!.scroll!.viewport + 1 || Math.abs(bottom.renderer!.scroll!.offset + bottom.renderer!.scroll!.max) > 1) throw new Error('The end of the authored page is not reachable by scrolling');
    await host.testWindow({ action: 'scroll', delta: 100_000 });
    await waitForFrame(initial.sequence, bottom.renderer!.frames);
    const clickTimings: number[] = [];
    const nativeTimings: unknown[] = [];
    for (const direction of [0, 0, 0, 1, 1, 1]) {
      const before = await host.inspect();
      const start = performance.now();
      await host.testWindow({ action: 'click', handle: counter.handle, node: buttons[direction]!.source });
      await events;
      const painted = await waitForFrame(before.sequence + 1, before.renderer!.frames);
      clickTimings.push(performance.now() - start);
      nativeTimings.push({ eventToCommit: painted.renderer!.event_to_commit_ms, eventToPaint: painted.renderer!.event_to_paint_ms, commitToPaint: painted.renderer!.commit_to_paint_ms, layout: painted.renderer!.layout_ms, frame: painted.renderer!.frame_ms });
    }
    if (Math.max(...clickTimings) > 500) throw new Error(`Native click-to-paint stalled: ${JSON.stringify(clickTimings)}`);
    const fragmentStart = initial.renderer.boxes.find(box => box.id === 'child-summary');
    const fragmentEnd = initial.renderer.boxes.find(box => box.id === 'child-fragment-end');
    if (!fragmentStart || !fragmentEnd || fragmentStart.handle.id !== fragmentEnd.handle.id || fragmentEnd.y <= fragmentStart.y || Math.abs(fragmentEnd.x-fragmentStart.x)>1) throw new Error('Child fragment roots were lost or reordered in native layout');
    await app.dispatch(child.handle, 0);
    const childClicked = await host.inspect();
    if (!childClicked.instances.find(instance => instance.handle.id === child.handle.id)?.text_groups.some(group => group.text === 'Local clicks: 1')) throw new Error('Child local state did not update');
    await app.dispatch(counter.handle, 0);
    const updated = await waitForFrame(childClicked.sequence + 1);
    if (!updated.instances.find(instance => instance.handle.id === counter.handle.id)?.text_groups.some(group => group.text === 'Count: 1')) throw new Error('Desktop counter was not updated');
    if (!updated.instances.some(instance => instance.text_groups.some(group => group.text === 'Inherited props: count 1, text '))) throw new Error('Reactive props did not reach the grandchild');
    if (!updated.instances.find(instance => instance.handle.id === child.handle.id)?.text_groups.some(group => group.text === 'Local clicks: 1')) throw new Error('Parent publication reset child local state');
    await app.dispatch(child.handle, 1);
    const branchShown = await waitForFrame(updated.sequence + 1);
    const branchBox = branchShown.renderer!.boxes.find(box => box.id === 'conditional-card');
    if (!branchBox || branchShown.instances.length !== 9) throw new Error('Conditional component was not inserted into native layout');
    const branch = branchShown.instances.find(instance => instance.handle.id === branchBox.handle.id)!;
    await app.dispatch(branch.handle, 0);
    await app.dispatch(counter.handle, 0);
    const branchUpdated = await waitForFrame(branchShown.sequence + 2);
    if (!branchUpdated.instances.find(instance => instance.handle.id === branch.handle.id)?.text_groups.some(group => group.text === 'Conditional count: 2') || !branchUpdated.instances.find(instance => instance.handle.id === branch.handle.id)?.text_groups.some(group => group.text === 'Branch clicks: 1')) throw new Error('Retained conditional child lost its state or props');
    await app.dispatch(child.handle, 1);
    const branchHidden = await waitForFrame(branchUpdated.sequence + 1);
    if (branchHidden.instances.length !== 8 || branchHidden.renderer!.boxes.some(box => box.id === 'conditional-card')) throw new Error('Conditional child was not retired from native layout');
    await host.redraw();
    const redrawn = await waitForFrame(branchHidden.sequence, branchHidden.renderer!.frames);
    if (redrawn.renderer!.shaping !== branchHidden.renderer!.shaping) throw new Error('Unchanged native text was reshaped');
    const listBox = redrawn.renderer!.boxes.find(box => box.id === 'list-demo');
    const row = redrawn.instances.find(instance => instance.template.endsWith('#ListRow') && instance.text_groups.some(group => group.text === 'First: 0'));
    if (!listBox || !row) throw new Error('Keyed native rows were not mounted');
    const beforeRow = redrawn.renderer!.boxes.find(box => box.tag === 'li' && box.handle.id === row.handle.id);
    await app.dispatch(row.handle, 0);
    const rowInput = redrawn.renderer!.boxes.find(box => box.tag === 'input' && box.handle.id === row.handle.id);
    if (!rowInput) throw new Error('Keyed row input was not laid out');
    await host.testInput(row.handle, rowInput.source, 'insert', 'retained🙂');
    const rowDeadline = Date.now() + 20_000;
    let rowTyped = await host.inspect();
    while (!rowTyped.instances.find(instance => instance.handle.id === row.handle.id)?.text_groups.some(group => group.text === 'Draft: retained🙂')) {
      if (Date.now() >= rowDeadline) throw new Error('Keyed row input did not publish');
      await Bun.sleep(25); rowTyped = await host.inspect();
    }
    await events;
    await app.dispatch(listBox.handle, 0);
    const reordered = await waitForFrame(rowTyped.sequence + 1);
    const retained = reordered.instances.find(instance => instance.handle.id === row.handle.id);
    const afterRow = reordered.renderer!.boxes.find(box => box.tag === 'li' && box.handle.id === row.handle.id);
    if (!beforeRow || !afterRow || afterRow.y <= beforeRow.y || !retained?.text_groups.some(group => group.text === 'First: 2') || !retained.text_groups.some(group => group.text === 'Row clicks: 1') || retained.texts[rowInput.source] !== 'retained🙂') throw new Error('Native movement lost keyed row state, input, or layout order');
    await app.dispatch(listBox.handle, 1);
    const inserted = await waitForFrame(reordered.sequence + 1);
    if (inserted.instances.length !== 9) throw new Error('Native row insertion did not publish');
    const removed = inserted.instances.find(instance => instance.template.endsWith('#ListRow') && instance.text_groups.some(group => group.text === 'Third: 0'))!;
    await app.dispatch(listBox.handle, 2);
    const listSettled = await waitForFrame(inserted.sequence + 1);
    if (listSettled.instances.length !== 8 || listSettled.instances.some(instance => instance.handle.id === removed.handle.id) || listSettled.renderer!.boxes.some(box => box.handle.id === removed.handle.id)) throw new Error('Removed row remained in native layout');
    const input = redrawn.renderer!.boxes.find(box => box.tag === 'input' && box.handle.id === counter.handle.id);
    if (!input || input.width <= 0 || input.height <= 0) throw new Error('Native input has empty layout bounds');
    let releaseGate!: () => void;
    let nativeInputPaintMs = 0;
    eventGate = new Promise<void>(resolve => { releaseGate = resolve; });
    try {
      const start = performance.now();
      await host.testInput(counter.handle, input.source, 'insert', 'a');
      const deadline = Date.now() + 1000;
      let painted = false;
      while (Date.now() < deadline) {
        const snapshot = await host.inspect();
        painted = !!snapshot.renderer?.inputs?.some(value => value.handle.id === counter.handle.id && value.node === input.source && value.text === 'a');
        if (painted) {
          nativeInputPaintMs = performance.now() - start;
          if (snapshot.instances.find(instance => instance.handle.id === counter.handle.id)!.texts[input.source] !== '') throw new Error('Delayed input callback was not held');
          break;
        }
        await Bun.sleep(10);
      }
      if (!painted) throw new Error('Native input waited for the authored callback before painting');
    } finally { releaseGate(); eventGate = Promise.resolve(); }
    await waitForInput(input.source, 'a');
    const inputTimings: number[] = [];
    const nativeInputTimings: unknown[] = [];
    for (const value of ['b', 'c', 'd']) {
      const before = await host.inspect();
      const start = performance.now();
      await host.testInput(counter.handle, input.source, 'insert', value);
      await events;
      const painted = await waitForFrame(before.sequence + 1, before.renderer!.frames);
      inputTimings.push(performance.now() - start);
      nativeInputTimings.push({ eventToCommit: painted.renderer!.event_to_commit_ms, eventToPaint: painted.renderer!.event_to_paint_ms, frame: painted.renderer!.frame_ms });
    }
    if (Math.max(...inputTimings) > 500) throw new Error(`Native edit-to-paint stalled: ${JSON.stringify(inputTimings)}`);
    await host.testInput(counter.handle, input.source, 'select-all');
    await host.testInput(counter.handle, input.source, 'backspace');
    await waitForInput(input.source, '');
    await Promise.all([host.testInput(counter.handle, input.source, 'insert', '静🙂'), host.testInput(counter.handle, input.source, 'insert', 'café')]);
    await waitForInput(input.source, '静🙂café');
    await host.testInput(counter.handle, input.source, 'backspace');
    await waitForInput(input.source, '静🙂caf');
    await host.testInput(counter.handle, input.source, 'select-all');
    await host.testInput(counter.handle, input.source, 'compose', 'に');
    await events;
    if ((await host.inspect()).instances.find(instance => instance.handle.id === counter.handle.id)!.texts[input.source] !== '静🙂caf') throw new Error('IME preedit leaked into authored state');
    await host.testInput(counter.handle, input.source, 'commit', '日本');
    const typed = await waitForInput(input.source, '日本');
    if (!typed.instances.some(instance => instance.text_groups.some(group => group.text === 'Inherited props: count 2, text 日本'))) throw new Error('Native input values did not reach the grandchild');
    const settled = await waitForFrame(typed.sequence);
    await host.redraw(); const stable = await waitForFrame(typed.sequence, settled.renderer!.frames);
    if (stable.renderer!.shaping !== settled.renderer!.shaping) throw new Error('Unchanged native input text was reshaped');
    smokeReport = { frames: stable.renderer!.frames, shaping: stable.renderer!.shaping, boxes: stable.renderer!.boxes.length, owners: stable.instances.length, input: '日本', clickToPaintMs: clickTimings.map(value => Math.round(value)), editToPaintMs: inputTimings.map(value => Math.round(value)), nativeTimings, nativeInputTimings, nativeInputPaintMs: Math.round(nativeInputPaintMs), scrollMax: stable.renderer!.scroll!.max };
  } else {
    console.log(`Desktop window is ready. Edit ${entry} and its TSX/CSS imports. Use Tab to focus buttons and the text input; typing updates the echoed value.`);
    await host.windowClosed;
  }
} finally {
  unsubscribe();
  await events;
  try { await app.dispose(); } finally {
    const start = performance.now();
    await host.close();
    shutdownMs = performance.now() - start;
  }
}
if (smokeReport) console.log('GPUI TSX/CSS/components/input window smoke test passed:', JSON.stringify({ ...smokeReport, shutdownMs: Math.round(shutdownMs) }));
