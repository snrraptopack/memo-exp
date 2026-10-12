import { mountScene, type DesktopApplication, type SceneSnapshot, type SceneTemplate } from '@memoized-dom/desktop';
import type { DesktopProcessHost } from '@memoized-dom/desktop/host';

/** Verify placement, sizing and hit tests through actual GPUI platform events. */
export async function runInlineBoxSmoke({ app, host, unmountExample, waitForFrame, settleEvents }: {
  app: DesktopApplication;
  host: DesktopProcessHost;
  unmountExample(): Promise<void>;
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
  const hovered = (snapshot: SceneSnapshot, id: string) => {
    const source = snapshot.renderer!.inline_ranges!.find((range) => range.id === id)!;
    return snapshot.renderer!.inline_hovered?.some((hovered) =>
      hovered.handle.id === source.handle.id
      && hovered.handle.generation === source.handle.generation
      && hovered.node === source.source,
    ) ?? false;
  };

  // The child changes weight while the component root supplies inherited paint.
  // Native hover paints both ancestors without publishing an application write.
  const beforeHover = snapshot;
  const normalWidths = nested.map((range) => range.width);
  await pointer('caption-text', 'hover');
  await waitFor((snapshot) => hovered(snapshot, 'caption') && hovered(snapshot, 'caption-text'));
  assert(snapshot.sequence === beforeHover.sequence, 'Inline hover published application state');
  const hoverWidths = snapshot.renderer!.inline_ranges!
    .filter((range) => range.id === 'caption-text').map((range) => range.width);
  assert(hoverWidths.length !== normalWidths.length
    || hoverWidths.some((width, index) => Math.abs(width - normalWidths[index]!) > 0.5),
  'The inline font-weight hover did not change GPUI glyph measurement');

  // Repeated hover on the same run must reuse shaping and glyph projection.
  const hoveredFrame = snapshot;
  await pointer('caption-text', 'hover');
  await host.redraw();
  snapshot = await waitForFrame(snapshot.sequence, hoveredFrame.renderer!.frames);
  assert(snapshot.renderer!.shaping === hoveredFrame.renderer!.shaping,
    'Moving within a hovered inline source reshaped unchanged text');
  assert(snapshot.renderer!.inline_geometry === hoveredFrame.renderer!.inline_geometry,
    'Moving within a hovered inline source rebuilt glyph regions');

  await pointer('title', 'hover');
  await waitFor((snapshot) => !hovered(snapshot, 'caption') && !hovered(snapshot, 'caption-text'));
  const restoredWidths = snapshot.renderer!.inline_ranges!
    .filter((range) => range.id === 'caption-text').map((range) => range.width);
  assert(restoredWidths.length === normalWidths.length
    && restoredWidths.every((width, index) => Math.abs(width - normalWidths[index]!) < 0.5),
  'Leaving the paragraph did not restore its normal glyph measurement');

  await pointer('hover-only', 'hover');
  await waitFor((snapshot) => hovered(snapshot, 'hover-only'));
  const hoverScroll = snapshot.renderer!.scroll!;
  const beforeScrollFrame = snapshot.renderer!.frames;
  await host.testWindow({
    action: 'scroll',
    delta: hoverScroll.max + hoverScroll.offset >= 80 ? -80 : 80,
  });
  await waitFor((snapshot) => snapshot.renderer!.frames > beforeScrollFrame
    && !hovered(snapshot, 'hover-only'));
  assert(Math.abs(snapshot.renderer!.scroll!.offset - hoverScroll.offset) > 1,
    'The inline hover scroll check did not move the paragraph');
  await pointer('title', 'hover');
  await waitFor((snapshot) => !hovered(snapshot, 'hover-only'));

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
  const report = {
    chipWidth: box('chip').width,
    clicks: 2,
    pointerDowns: 2,
    pointerUps: 2,
    parentClicks: 2,
    gridCells: 2,
    shaping: snapshot.renderer!.shaping,
    inlineRegions: ranges.length,
    inlineClicks: 1,
    inlineHover: true,
    hoverWithoutHandler: true,
    inlineLabelSubmissions: 1,
  };

  // Retire the authored example first, so no mounted template supplies native
  // event interests. This fixture isolates presentation-only hover and clipping.
  await unmountExample();
  const template: SceneTemplate = {
    id: 'handlerless-inline-hover',
    nodes: [
      {
        kind: 'element', tag: 'main', parent: null, text: '',
        style: [
          { property: 'padding', value: '32px' },
          { property: 'font-family', value: '"Segoe UI"' },
          { property: 'font-size', value: '16px' },
        ],
      },
      { kind: 'element', tag: 'p', parent: 0, text: '' },
      { kind: 'element', tag: 'span', parent: 1, text: '', attributes: { id: 'handlerless' } },
      { kind: 'text', parent: 2, text: 'Hover only' },
      {
        kind: 'element', tag: 'div', parent: 0, text: '',
        style: [{ property: 'height', value: '1600px' }],
      },
    ],
    slots: [],
    events: [],
    stylesheets: [{
      selectors: [[{
        combinator: null,
        selectors: [{ type: 'id', name: 'handlerless' }, { type: 'state', name: 'hover' }],
      }]],
      declarations: [
        { property: 'color', value: '#166534' },
        { property: 'font-weight', value: '900' },
      ],
    }],
  };
  const owner = app.mount(() => mountScene(template, [], []));
  let fixtureEvents = 0;
  const unsubscribe = host.onEvent(event => {
    if (event.handle.id === owner.handle.id) fixtureEvents++;
  });
  try {
    await owner.ready;
    await waitFor(snapshot => snapshot.renderer!.inline_ranges!.some(range => range.id === 'handlerless'));
    const normal = snapshot;
    const normalWidth = box('handlerless').width;
    await pointer('handlerless', 'hover');
    await waitFor(snapshot => hovered(snapshot, 'handlerless'));
    assert(Math.abs(box('handlerless').width - normalWidth) > 0.5,
      'A scene without event sites did not apply inline hover weight');
    await host.testWindow({ action: 'scroll', delta: -180 });
    await waitFor(snapshot => snapshot.renderer!.scroll!.offset < -100
      && !hovered(snapshot, 'handlerless'));
    assert(box('handlerless').y + box('handlerless').height < 0,
      'The handlerless hover check did not fully clip the paragraph');
    assert(Math.abs(box('handlerless').width - normalWidth) < 0.5,
      'Clipping retained the hovered glyph weight after its ancestry cleared');
    await host.testWindow({ action: 'scroll', delta: 180 });
    await waitFor(snapshot => hovered(snapshot, 'handlerless'));
    assert(Math.abs(box('handlerless').width - normalWidth) > 0.5,
      'Scrolling back under a stationary pointer did not reapply hover weight');
    assert(snapshot.sequence === normal.sequence && fixtureEvents === 0,
      'Handlerless hover or scrolling published an application event or write');
  } finally {
    unsubscribe();
    await owner.dispose();
  }
  return { ...report, handlerlessSceneHover: true, clippedHoverCleared: true };
}
