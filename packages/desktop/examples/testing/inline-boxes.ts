import type { SceneSnapshot } from '@memoized-dom/desktop';
import type { DesktopProcessHost } from '@memoized-dom/desktop/host';

/** Verify placement, sizing and hit tests through actual GPUI platform events. */
export async function runInlineBoxSmoke({ host, waitForFrame, settleEvents }: {
  host: DesktopProcessHost;
  waitForFrame(sequence: number, afterFrame?: number): Promise<SceneSnapshot>;
  settleEvents(): Promise<void>;
}) {
  let snapshot = await waitForFrame(1);
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const box = (id: string) => {
    const found = snapshot.renderer!.boxes.find((box) => box.id === id)
      ?? snapshot.renderer!.inline_ranges?.find((range) => range.id === id);
    if (!found) throw new Error(`Missing inline example box: ${id}`);
    return found;
  };
  const waitFor = async (matches: (snapshot: SceneSnapshot) => boolean) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const next = await host.inspect();
      if (next.renderer?.error) throw new Error(next.renderer.error);
      if (next.renderer?.sequence === next.sequence && matches(next)) {
        snapshot = next;
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error('Native inline boxes did not reach the expected painted state');
  };
  const hasText = (snapshot: SceneSnapshot, text: string) =>
    snapshot.flow!.text_groups.some((group) => group.text === text);
  const pointer = async (id: string, action: 'click' | 'hover' | 'pointerdown' | 'pointerup') => {
    let target = box(id);
    const viewport = snapshot.renderer!.scroll!.viewport;
    if (target.y < 0 || target.y + target.height > viewport) {
      await host.testWindow({ action: 'scroll', delta: viewport / 2 - target.y - target.height / 2 });
      snapshot = await waitForFrame(snapshot.sequence, snapshot.renderer!.frames);
      target = box(id);
    }
    await host.testWindow({ action, handle: target.handle, node: target.source });
    await settleEvents();
  };

  const initial = box('chip');
  assert(Math.abs(initial.width - 220) < 1, 'The span width did not reach Taffy');
  assert(Math.abs(initial.height - 112) < 1, 'The span height did not reach Taffy');
  assert(box('sibling').x >= initial.x + initial.width + 15,
    'Separate inline flex items lost their authored gap');
  const chip = snapshot.instances.find((instance) => instance.handle.id === initial.handle.id)!;

  await pointer('chip', 'hover');
  await waitFor((snapshot) => snapshot.renderer!.boxes.some((box) =>
    box.id === 'chip' && Math.abs(box.height - 132) < 1,
  ));
  await pointer('title', 'hover');
  await waitFor((snapshot) => snapshot.renderer!.boxes.some((box) =>
    box.id === 'chip' && Math.abs(box.height - 112) < 1,
  ));

  // Native hit testing must select the child span exactly once. JavaScript then
  // bubbles the click across component owners using the existing core runtime.
  await pointer('chip', 'click');
  await waitFor((snapshot) =>
    hasText(snapshot, 'Clicks: 1\nDown: 1\nUp: 1') && hasText(snapshot, 'Parent clicks: 1'),
  );
  await pointer('resize', 'click');
  await waitFor((snapshot) => snapshot.renderer!.boxes.some((box) =>
    box.id === 'chip' && Math.abs(box.width - 280) < 1,
  ));
  assert(box('chip').handle.id === chip.handle.id, 'Resizing remounted the inline component');
  assert(hasText(snapshot, 'Clicks: 1\nDown: 1\nUp: 1'), 'Resizing reset inline state');
  assert(hasText(snapshot, 'Resize pointer releases: 1'), 'A button lost or duplicated pointer-up');
  await pointer('chip', 'click');
  await waitFor((snapshot) =>
    hasText(snapshot, 'Clicks: 2\nDown: 2\nUp: 2') && hasText(snapshot, 'Parent clicks: 2'),
  );

  // The resize button retains focus. Space activates it without a physical
  // mouse release; the pointer-up counter must remain at its previous value.
  await host.testWindow({ action: 'key', key: 'space', phase: 'down' });
  await host.testWindow({ action: 'key', key: 'space', phase: 'up' });
  await settleEvents();
  await waitFor((snapshot) => snapshot.renderer!.boxes.some((box) =>
    box.id === 'chip' && Math.abs(box.width - 220) < 1,
  ));
  assert(hasText(snapshot, 'Resize pointer releases: 1'), 'Keyboard activation invented pointer-up');

  const first = box('cell-a');
  const last = box('cell-b');
  assert(Math.abs(first.y - last.y) < 1, 'A boxed span did not lay out its grid children');
  assert(Math.abs(first.width - last.width) < 1, 'Inline grid tracks did not share the width');
  assert(last.x >= first.x + first.width + 11, 'Inline grid children lost their gap');

  const paragraph = box('inline-paragraph');
  const ranges = snapshot.renderer!.inline_ranges!.filter((range) => range.id === 'caption');
  const nested = snapshot.renderer!.inline_ranges!.filter((range) => range.id === 'caption-text');
  assert(ranges.length >= 2, 'A wrapped inline source did not produce separate line regions');
  assert(nested.length >= 2, 'Nested component sources lost their wrapped glyph regions');
  for (const range of ranges) {
    assert(range.width > 0 && range.height > 0, 'An inline source has empty measured bounds');
    assert(range.x >= paragraph.x - 0.5 && range.x + range.width <= paragraph.x + paragraph.width + 0.5,
      'Inline geometry did not follow the aligned paragraph bounds');
    const child = nested.find((child) => Math.abs(child.y - range.y) < 0.5);
    if (child) {
      assert(child.x >= range.x - 0.5 && child.x + child.width <= range.x + range.width + 0.5,
        'Nested inline ancestry did not point to its enclosing rendered glyphs');
    }
  }
  assert(!snapshot.renderer!.boxes.some((box) => box.id === 'caption' || box.id === 'caption-text'),
    'Measured inline sources acquired unwanted layout boxes');
  const captionHandle = box('caption').handle;
  await pointer('caption-text', 'click');
  await waitFor((snapshot) => snapshot.instances.some((instance) =>
    instance.handle.id === captionHandle.id && instance.text_groups.some((group) => group.text.endsWith('(1)')),
  ));
  await pointer('caption-text', 'pointerdown');
  await pointer('title', 'pointerup');
  const frameBeforeRelease = snapshot.renderer!.frames;
  await pointer('caption-text', 'pointerup');
  await host.redraw();
  snapshot = await waitForFrame(snapshot.sequence, frameBeforeRelease);
  assert(snapshot.instances.some((instance) => instance.handle.id === captionHandle.id
    && instance.text_groups.some((group) => group.text.endsWith('(1)'))),
  'Releasing outside the paragraph left stale press history');
  await pointer('save-label', 'click');
  await waitFor((snapshot) => hasText(snapshot, 'Submissions: 1'));
  const submit = box('save');
  assert(snapshot.renderer!.focused?.handle.id === submit.handle.id
    && snapshot.renderer!.focused?.node === submit.source,
  'Clicking an inline button label lost its native focus default');

  const painted = snapshot;
  await host.redraw();
  snapshot = await waitForFrame(painted.sequence, painted.renderer!.frames);
  assert(snapshot.renderer!.shaping === painted.renderer!.shaping,
    'An unchanged inline box reshaped its text');
  assert(snapshot.renderer!.inline_geometry === painted.renderer!.inline_geometry,
    'An unchanged frame rebuilt inline glyph regions');
  return {
    chipWidth: box('chip').width,
    clicks: 2,
    pointerDowns: 2,
    pointerUps: 2,
    parentClicks: 2,
    gridCells: 2,
    shaping: snapshot.renderer!.shaping,
    inlineRegions: ranges.length,
    inlineClicks: 1,
    inlineLabelSubmissions: 1,
  };
}
