import { mountScene, type DesktopApplication, type SceneElement, type SceneMeasurement, type SceneSnapshot, type SceneTemplate } from '@memoized-dom/desktop';
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
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await waitFor(() => true);
      const target = box(id);
      const renderer = snapshot.renderer!;
      const viewport = renderer.scroll!.viewport;
      const fragments = [...renderer.boxes, ...(renderer.inline_ranges ?? [])].filter(fragment =>
        fragment.handle.id === target.handle.id
        && fragment.handle.generation === target.handle.generation
        && fragment.source === target.source,
      );
      const visible = fragments.some(fragment => fragment.width > 0 && fragment.height > 0
        && fragment.x < renderer.width && fragment.x + fragment.width > 0
        && fragment.y < viewport && fragment.y + fragment.height > 0);
      if (!visible) {
        await host.testWindow({ action: 'scroll', delta: viewport / 2 - target.y - target.height / 2 });
        snapshot = await waitForFrame(snapshot.sequence, renderer.frames);
        continue;
      }
      try {
        await host.testWindow({ action, handle: target.handle, node: target.source, frame: renderer.frames });
      } catch (error) {
        if (error instanceof Error && error.message === 'Test pointer geometry is stale') {
          // Native admission rejected before dispatch. Reinspect instead of
          // repeating an input whose acceptance might otherwise be unknown.
          continue;
        }
        throw new Error(`Native ${action} failed for ${id} at ${JSON.stringify(target)}`, { cause: error });
      }
      await settleEvents();
      return;
    }
    throw new Error(`Native ${action} could not acquire painted viewport geometry for ${id}`);
  };

  // A stale command must reject without delivering any part of a click. Force
  // a new painted frame rather than relying on platform scheduling to race it.
  const oldFrame = snapshot.renderer!.frames;
  const untouched = box('chip');
  await host.redraw();
  snapshot = await waitForFrame(snapshot.sequence, oldFrame);
  let staleRejected = false;
  try {
    await host.testWindow({ action: 'click', handle: untouched.handle, node: untouched.source, frame: oldFrame });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Test pointer geometry is stale') throw error;
    staleRejected = true;
  }
  assert(staleRejected, 'A stale pointer command did not reject');
  await settleEvents();
  await waitFor(() => true);
  assert(hasText(snapshot, 'Clicks: 0\nDown: 0\nUp: 0') && hasText(snapshot, 'Parent clicks: 0'),
    'A rejected stale pointer command emitted an input event');

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
  const cursorMatches = (snapshot: SceneSnapshot, provider: string, style: 'Arrow' | 'IBeam' | 'PointingHand') => {
    const range = snapshot.renderer!.inline_ranges!.find(range => range.id === provider)!;
    const request = snapshot.renderer!.inline_cursor;
    return request?.style === style
      && request.source.handle.id === range.handle.id
      && request.source.handle.generation === range.handle.generation
      && request.source.node === range.source;
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

  // These cursor rules have no text refinements. Cross-owner inheritance,
  // explicit defaults and hover overrides must reuse glyph preparation.
  const beforeCursor = snapshot;
  for (const [target, provider, style] of [
    ['cursor-inherited', 'cursor-parent', 'PointingHand'],
    ['cursor-text', 'cursor-text', 'IBeam'],
    ['cursor-default', 'cursor-default', 'Arrow'],
    ['cursor-hover', 'cursor-hover', 'IBeam'],
  ] as const) {
    await pointer(target, 'hover');
    await waitFor(snapshot => cursorMatches(snapshot, provider, style));
  }
  await pointer('cursor-plain', 'hover');
  await waitFor(snapshot => snapshot.renderer!.inline_cursor === null);
  assert(snapshot.sequence === beforeCursor.sequence, 'Cursor CSS published application state');
  assert(snapshot.renderer!.shaping === beforeCursor.renderer!.shaping,
    'Cursor-only source changes reshaped text');
  assert(snapshot.renderer!.inline_geometry === beforeCursor.renderer!.inline_geometry,
    'Cursor-only source changes rebuilt glyph regions');
  assert(!snapshot.renderer!.boxes.some(box => box.id?.startsWith('cursor-') && box.id !== 'cursor-paragraph'),
    'Inline cursor rules introduced independent layout boxes');

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
    inlineCursors: 4,
    stalePointerRejected: true,
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
      {
        kind: 'element', tag: 'p', parent: 0, text: '',
        style: [{ property: 'cursor', value: 'text' }],
      },
      { kind: 'element', tag: 'span', parent: 1, text: '', attributes: { id: 'handlerless' } },
      { kind: 'text', parent: 2, text: 'Hover only' },
      {
        kind: 'element', tag: 'p', parent: 0, text: '',
        style: [{ property: 'width', value: '120px' }],
      },
      { kind: 'element', tag: 'span', parent: 4, text: '', attributes: { id: 'wrapped-target' } },
      { kind: 'text', parent: 5, text: 'Wrapped glyphs follow several native lines' },
      { kind: 'element', tag: 'div', parent: 0, text: '', style: [{ property: 'height', value: '1600px' }] },
      { kind: 'text', parent: 1, text: ' ' },
      { kind: 'element', tag: 'span', parent: 1, text: '', attributes: { id: 'cursor-only' } },
      { kind: 'text', parent: 9, text: 'Cursor only' },
      { kind: 'text', parent: 1, text: ' ' },
      { kind: 'element', tag: 'span', parent: 1, text: '', attributes: { id: 'plain-source' } },
      { kind: 'text', parent: 12, text: 'Plain text' },
      { kind: 'element', tag: 'span', parent: 1, text: '', attributes: { id: 'empty-source' } },
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
        { property: 'cursor', value: 'pointer' },
      ],
    }, {
      selectors: [[{
        combinator: null,
        selectors: [{ type: 'id', name: 'cursor-only' }, { type: 'state', name: 'hover' }],
      }]],
      declarations: [{ property: 'cursor', value: 'default' }],
    }, {
      selectors: [[{ combinator: null, selectors: [{ type: 'id', name: 'wrapped-target' }] }]],
      declarations: [{ property: 'cursor', value: 'pointer' }],
    }],
  };
  let wrappedRef!: SceneElement;
  let boxRef!: SceneElement;
  let emptyRef!: SceneElement;
  let initialMeasurement!: Promise<SceneMeasurement>;
  const owner = app.mount(() => mountScene(template, [], [], {
    refs: [{ node: 0, value(element) { boxRef = element; } },
    { node: 14, value(element) { emptyRef = element; } },
    { node: 5, value(element) {
      wrappedRef = element;
      // Request immediately on acceptance, without an inspector/frame wait.
      initialMeasurement = element.measure();
    } }],
  }));
  let fixtureEvents = 0;
  const unsubscribe = host.onEvent(event => {
    if (event.handle.id === owner.handle.id) fixtureEvents++;
  });
  try {
    await owner.ready;
    const initialGeometry = await initialMeasurement;
    assert(initialGeometry.sequence >= snapshot.sequence && initialGeometry.frame > 0,
      'Initial ref measurement resolved before its accepted scene painted');
    assert(initialGeometry.rects.length > 1, 'Native ref measurement lost wrapped fragments');
    const emptyGeometry = await emptyRef.measure();
    assert(emptyGeometry.rects.length === 0 && emptyGeometry.bounds === null,
      'An empty inline source acquired fabricated geometry');
    const boxGeometry = await boxRef.measure();
    assert(boxGeometry.rects.length === 1 && boxGeometry.bounds!.height > 1600,
      'A native layout ref did not report its actual layout box');
    await waitFor(snapshot => snapshot.renderer!.inline_ranges!.some(range => range.id === 'handlerless'));
    const normal = snapshot;
    const normalWidth = box('handlerless').width;
    await pointer('cursor-only', 'hover');
    await waitFor(snapshot => cursorMatches(snapshot, 'cursor-only', 'Arrow'));
    await pointer('plain-source', 'hover');
    await waitFor(snapshot => snapshot.renderer!.inline_cursor === null);
    assert(snapshot.renderer!.shaping === normal.renderer!.shaping,
      'Handlerless cursor-only CSS changed text shaping');
    assert(snapshot.renderer!.inline_geometry === normal.renderer!.inline_geometry,
      'Handlerless cursor-only CSS rebuilt measured source geometry');
    await pointer('handlerless', 'hover');
    await waitFor(snapshot => hovered(snapshot, 'handlerless')
      && cursorMatches(snapshot, 'handlerless', 'PointingHand'));
    assert(Math.abs(box('handlerless').width - normalWidth) > 0.5,
      'A scene without event sites did not apply inline hover weight');
    // Clip both paragraph fixtures so the stationary pointer is over plain
    // content during the hover-retirement check, rather than another source.
    await host.testWindow({ action: 'scroll', delta: -360 });
    await waitFor(snapshot => snapshot.renderer!.scroll!.offset < -100
      && !hovered(snapshot, 'handlerless') && snapshot.renderer!.inline_cursor === null);
    assert(box('handlerless').y + box('handlerless').height < 0,
      'The handlerless hover check did not fully clip the paragraph');
    assert(Math.abs(box('handlerless').width - normalWidth) < 0.5,
      'Clipping retained the hovered glyph weight after its ancestry cleared');
    await host.testWindow({ action: 'scroll', delta: 360 });
    await waitFor(snapshot => hovered(snapshot, 'handlerless')
      && cursorMatches(snapshot, 'handlerless', 'PointingHand'));
    assert(Math.abs(box('handlerless').width - normalWidth) > 0.5,
      'Scrolling back under a stationary pointer did not reapply hover weight');
    const firstWrapped = box('wrapped-target');
    const wrappedFragments = snapshot.renderer!.inline_ranges!.filter(range => range.id === 'wrapped-target');
    assert(wrappedFragments.length > 1, 'The wrapped pointer fixture did not wrap');
    await host.testWindow({ action: 'scroll', delta: -firstWrapped.y - firstWrapped.height - 1 });
    await waitFor(snapshot => {
      const fragments = snapshot.renderer!.inline_ranges!.filter(range => range.id === 'wrapped-target');
      return fragments[0]!.y + fragments[0]!.height < 0 && fragments.some(fragment => fragment.y >= 0);
    });
    await pointer('wrapped-target', 'hover');
    await waitFor(snapshot => cursorMatches(snapshot, 'wrapped-target', 'PointingHand'));
    assert(box('wrapped-target').y + box('wrapped-target').height < 0,
      'Pointer targeting scrolled a visible later fragment back to its first line');
    const measured = await wrappedRef.measure();
    const expected = snapshot.renderer!.inline_ranges!.filter(range => range.id === 'wrapped-target');
    assert(measured.sequence === snapshot.sequence && measured.frame >= snapshot.renderer!.frames,
      'Measurement did not report its completed native frame');
    assert(measured.rects.length === expected.length && measured.rects.every((rect, index) =>
      rect.x === expected[index]!.x && rect.y === expected[index]!.y
        && rect.width === expected[index]!.width && rect.height === expected[index]!.height),
    'Ref measurement diverged from actual shaped glyph geometry');
    assert(measured.rects[0]!.y < 0 && measured.bounds!.height > measured.rects[0]!.height,
      'Native measurement cropped offscreen fragments or lost their union');

    // Request directly after a wheel command, with no inspector/frame barrier.
    // The scene sequence is unchanged, but window-relative rectangles are not.
    const previousOffset = snapshot.renderer!.scroll!.offset;
    await host.testWindow({ action: 'scroll', delta: -17 });
    const afterScroll = await wrappedRef.measure();
    const current = await host.inspect();
    const movement = current.renderer!.scroll!.offset - previousOffset;
    assert(movement < -0.5, 'The measurement scroll fixture did not move');
    assert(afterScroll.frame > measured.frame && afterScroll.sequence === measured.sequence,
      'Measurement reused the pre-scroll frame at the same scene sequence');
    assert(afterScroll.rects.length === measured.rects.length && afterScroll.rects.every((rect, index) => {
      const previous = measured.rects[index]!;
      return Math.abs(rect.y - previous.y - movement) < 0.5
        && rect.x === previous.x && rect.width === previous.width && rect.height === previous.height;
    }), 'Immediate measurement did not include the actual GPUI scroll offset');

    // The OS applies resizing asynchronously. Poll the measurement itself until
    // that size arrives, without using an inspector or forced-redraw barrier.
    await host.testWindow({ action: 'resize', width: 640, height: 640 });
    const resizeDeadline = Date.now() + 20_000;
    let afterResize = await boxRef.measure();
    while (Math.abs(afterResize.bounds!.width - 640) > 0.5 && Date.now() < resizeDeadline) {
      await Bun.sleep(15);
      afterResize = await boxRef.measure();
    }
    assert(Math.abs(afterResize.bounds!.width - 640) < 0.5
      && afterResize.frame > boxGeometry.frame && afterResize.sequence === boxGeometry.sequence,
    'Measurement did not use the applied GPUI viewport at the same scene sequence');

    assert(snapshot.sequence === normal.sequence && fixtureEvents === 0,
      'Handlerless hover or scrolling published an application event or write');
  } finally {
    unsubscribe();
    await owner.dispose();
  }
  let retiredRejected = false;
  try { await wrappedRef.measure(); } catch { retiredRejected = true; }
  assert(retiredRejected, 'Retired native refs retained measurement capability');
  return {
    ...report,
    handlerlessSceneHover: true,
    clippedHoverCleared: true,
    handlerlessCursor: true,
    visibleWrappedTarget: true,
    nativeRefMeasurement: true,
    measurementAfterScroll: true,
    measurementAfterResize: true,
  };
}
