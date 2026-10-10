import type { SceneSnapshot } from '@memoized-dom/desktop';
import type { DesktopProcessHost } from '@memoized-dom/desktop/host';

/** Real native clicks and edits exercise the authored example and its callbacks. */
export async function runTodoSmoke({
  host,
  waitForFrame,
  settleEvents,
  captureLayout,
}: {
  host: DesktopProcessHost;
  waitForFrame(sequence: number, afterFrame?: number): Promise<SceneSnapshot>;
  settleEvents(): Promise<void>;
  captureLayout?(snapshot: SceneSnapshot): void;
}) {
  let snapshot = await waitForFrame(1);
  const box = (id: string, handle?: number) => {
    const value = snapshot.renderer!.boxes.find(
      (item) => item.id === id && (handle === undefined || item.handle.id === handle),
    );
    if (!value) throw new Error(`Missing native todo box: ${id}`);
    return value;
  };
  const rows = () =>
    snapshot.instances.filter((instance) => instance.template.endsWith('#TodoRow'));
  const assertRowSelectors = () => {
    const cards = snapshot.renderer!.boxes.filter(item => item.tag === 'article');
    assert(cards.length === rows().length, 'Inline row wrappers did not paint');
    const sorted = [...cards].sort((a, b) => a.y - b.y);
    for (const [index, card] of sorted.entries()) {
      const owner = snapshot.instances.find(instance => instance.handle.id === card.handle.id)!;
      const style = owner.styles?.[card.source]?.states[0];
      assert(style?.['display'] === 'flex', 'Child selector did not cross the keyed row region');
      assert(style?.['padding-left'] === (index === 0 ? '18px' : '22px'),
        'Adjacent sibling selector did not follow accepted row order');
      assert(card.width > 100, 'Matched row CSS did not reach native layout');
    }
    for (const title of snapshot.renderer!.boxes.filter(item =>
      item.id === 'active-title' || item.id === 'completed-title')) {
      const owner = snapshot.instances.find(instance => instance.handle.id === title.handle.id)!;
      assert(owner.styles?.[title.source]?.states[0]?.['font-size'] === '16px',
        'Descendant selector did not cross the named row and title branch');
    }
  };
  const texts = () =>
    snapshot.instances.flatMap((instance) => instance.text_groups.map((group) => group.text));
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const refresh = async () => {
    await settleEvents();
    snapshot = await waitForFrame(snapshot.sequence + 1);
  };
  const waitForLayout = async (matches: (snapshot: SceneSnapshot) => boolean) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const painted = await host.inspect();
      if (painted.renderer?.error) throw new Error(painted.renderer.error);
      if (painted.renderer && matches(painted)) {
        snapshot = painted;
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error('Native Todo layout did not reach the requested state');
  };
  const resize = async (width: number, height: number) => {
    const previousFrame = snapshot.renderer!.frames;
    await host.testWindow({ action: 'resize', width, height });
    // The OS may clamp window height to the monitor's work area. Compare the
    // requested width and use the actual scroll viewport for visibility checks.
    await waitForLayout(
      (painted) =>
        painted.renderer!.frames > previousFrame &&
        Math.abs(painted.renderer!.width - width) <= 1 &&
        painted.renderer!.scroll!.viewport > 0,
    );
  };
  const click = async (id: string, handle?: number) => {
    let target = box(id, handle);
    const viewport = snapshot.renderer!.scroll!.viewport;
    if (target.y < 0 || target.y + target.height > viewport) {
      await host.testWindow({
        action: 'scroll',
        delta: viewport / 2 - target.y - target.height / 2,
      });
      snapshot = await waitForFrame(snapshot.sequence, snapshot.renderer!.frames);
      target = box(id, handle);
    }
    await host.testWindow({ action: 'click', handle: target.handle, node: target.source });
    await refresh();
  };
  const input = async (id: string, text: string, handle?: number) => {
    const target = box(id, handle);
    await host.testInput(target.handle, target.source, 'insert', text);
    await refresh();
  };
  const key = async (key: string) => {
    const previousFrame = snapshot.renderer!.frames;
    await host.testWindow({ action: 'key', key });
    await settleEvents();
    const accepted = await host.inspect();
    // Canceled keys may not publish a transaction. Require a fresh frame at
    // the accepted sequence so focus and newly inserted rows are both painted.
    await host.redraw();
    snapshot = await waitForFrame(accepted.sequence, previousFrame);
    await settleEvents();
  };

  assert(rows().length === 3, 'Todo seed tasks did not mount');
  assertRowSelectors();
  await resize(1200, 800);
  const page = box('todo-page');
  const workspace = box('todo-workspace');
  assert(
    workspace.width <= 961 &&
      Math.abs(workspace.x - page.x - (page.width - workspace.width) / 2) <= 1,
    'Todo workspace is not centered with max-width and auto margins',
  );
  const stats = ['stat-total', 'stat-active', 'stat-done'].map((id) => box(id));
  assert(
    stats.every(
      (item) => Math.abs(item.width - stats[0]!.width) <= 1 && Math.abs(item.y - stats[0]!.y) <= 1,
    ),
    'Todo grid cards did not receive equal-width columns',
  );
  captureLayout?.(snapshot);
  await input('new-task', '静🙂 café');
  assert(texts().includes('Typing: 静🙂 café'), 'Typing did not update the authored preview');
  await key('shift-enter');
  assert(
    rows().length === 3 && texts().includes('Typing: 静🙂 café'),
    `Canceled Enter submitted or cleared the draft: ${JSON.stringify({
      rows: rows().length,
      preview: texts().filter((text) => text.startsWith('Typing:')),
      focused: snapshot.renderer!.focused,
    })}`,
  );
  await key('ctrl-tab');
  assert(
    snapshot.renderer!.focused?.node === box('new-task').source,
    'Canceled Tab moved input focus',
  );
  await key('tab');
  assert(
    snapshot.renderer!.focused?.node === box('add-task').source,
    'Tab did not focus the next authored control',
  );
  await key('shift-tab');
  assert(
    snapshot.renderer!.focused?.node === box('new-task').source,
    'Shift+Tab did not return to the input',
  );
  await click('add-task');
  assertRowSelectors();
  assert(
    rows().length === 4 && texts().includes('静🙂 café'),
    'Add did not insert the authored task',
  );
  assert(texts().includes('Typing: '), 'Adding did not clear the native bound input');
  const added = rows().find((row) => row.text_groups.some((group) => group.text === 'Task #4'))!;
  await click('toggle-task', added.handle.id);
  assert(
    snapshot.instances.some(
      (instance) =>
        snapshot.renderer!.boxes.some(box => box.handle.id === instance.handle.id && box.id === 'completed-title') &&
        instance.attach_to?.handle.id === added.handle.id,
    ),
    'Row callback did not complete its parent-owned task',
  );
  await click('toggle-task', added.handle.id);
  await input('row-note', 'retained note', added.handle.id);

  // Queue physical clicks without waiting for each authored publication. This
  // catches lost callbacks or a state reset hidden by one-at-a-time checks.
  const toggleButton = box('toggle-task', added.handle.id);
  const burstClicks = 6;
  const clickStart = performance.now();
  await Promise.all(
    Array.from({ length: burstClicks }, () =>
      host.testWindow({
        action: 'click',
        handle: toggleButton.handle,
        node: toggleButton.source,
      }),
    ),
  );
  await settleEvents();
  let accepted = await host.inspect();
  snapshot = await waitForFrame(accepted.sequence);
  assert(
    snapshot.instances.some(
      (instance) =>
        snapshot.renderer!.boxes.some(box => box.handle.id === instance.handle.id && box.id === 'active-title') &&
        instance.attach_to?.handle.id === added.handle.id,
    ),
    'Rapid clicks lost a task toggle or reset its owner',
  );
  const burstClickMs = performance.now() - clickStart;

  // Consecutive edits use the real retained input entity and its numbered
  // acknowledgments. Newer native text must survive older acknowledgments.
  const noteInput = box('row-note', added.handle.id);
  const suffix = ' burst🙂';
  const typingStart = performance.now();
  await Promise.all(
    [...suffix].map((character) =>
      host.testInput(noteInput.handle, noteInput.source, 'insert', character),
    ),
  );
  await settleEvents();
  accepted = await host.inspect();
  snapshot = await waitForFrame(accepted.sequence);
  const retainedNote = 'retained note' + suffix;
  assert(texts().includes('Note: ' + retainedNote), 'Rapid typing lost or reordered an edit');
  assert(
    snapshot.renderer!.inputs?.some(
      (input) =>
        input.handle.id === added.handle.id &&
        input.node === noteInput.source &&
        input.text === retainedNote,
    ) === true,
    'Rapid typing did not reach the native painted input',
  );
  const burstTypingMs = performance.now() - typingStart;

  // Reorder from the focused input so a click cannot hide a lost focus handle.
  const focusedNote = snapshot.renderer!.focused;
  assert(focusedNote?.handle.id === added.handle.id, 'Row note did not receive focus');
  await key('ctrl-r');
  assertRowSelectors();
  captureLayout?.(snapshot);
  assert(
    snapshot.renderer!.focused?.handle.id === focusedNote!.handle.id &&
      snapshot.renderer!.focused?.node === focusedNote!.node,
    'Reordering inline keyed rows replaced the focused native input',
  );
  assert(
    rows()
      .find((row) => row.handle.id === added.handle.id)
      ?.text_groups.some((group) => group.text === 'Note: ' + retainedNote) === true,
    'Reordering lost the keyed row note',
  );
  await click('delete-task', added.handle.id);
  assertRowSelectors();
  assert(
    rows().length === 3 && !rows().some((row) => row.handle.id === added.handle.id),
    'Delete did not retire the requested row',
  );
  await input('new-task', 'Enter submitted');
  await key('enter');
  assert(
    rows().length === 4 && texts().includes('Enter submitted'),
    'Enter did not submit the authored form',
  );
  const entered = rows().find((row) => row.text_groups.some((group) => group.text === 'Task #5'))!;
  await click('delete-task', entered.handle.id);
  await click('filter-done');
  assert(rows().length === 1, 'Completed filter did not select one task');
  await click('filter-all');
  assert(rows().length === 3, 'All filter did not restore tasks');
  await click('clear-done');
  assert(rows().length === 2, 'Clear completed did not remove the completed task');
  await click('add-samples');
  assert(rows().length === 22, 'Scroll sample tasks did not mount');
  await resize(500, 700);
  const narrow = box('todo-workspace');
  assert(narrow.width <= 437 && narrow.x >= 31, 'Narrow layout lost page gutters');
  for (const item of snapshot.renderer!.boxes)
    assert(
      (item.x >= narrow.x - 1 && item.x + item.width <= narrow.x + narrow.width + 1) ||
        item.id === 'todo-page',
      `Todo box overflows narrow workspace: ${item.tag} ${item.id}`,
    );
  assert(box('add-task').y > box('new-task').y, 'Narrow editor did not wrap its add button');
  captureLayout?.(snapshot);
  const beforeScroll = snapshot.renderer!.frames;
  await host.testWindow({ action: 'scroll', delta: -100_000 });
  await waitForLayout((painted) => {
    const renderer = painted.renderer!;
    const scroll = renderer.scroll!;
    const footer = renderer.boxes.find((box) => box.id === 'todo-footer');
    return (
      renderer.frames > beforeScroll &&
      Math.abs(scroll.offset + scroll.max) <= 1 &&
      footer !== undefined &&
      footer.y >= 0 &&
      footer.y + footer.height <= scroll.viewport + 1
    );
  });
  const footer = box('todo-footer');
  assert(
    footer.y >= 0 && footer.y + footer.height <= snapshot.renderer!.scroll!.viewport + 1,
    'Todo footer is not reachable by scrolling',
  );
  const last = rows().at(-1)!;
  await click('delete-task', last.handle.id);
  assert(rows().length === 21, 'Native row click after scrolling did not delete');
  return {
    owners: snapshot.instances.length,
    tasks: rows().length,
    scrollMax: snapshot.renderer!.scroll!.max,
    frameMs: snapshot.renderer!.frame_ms,
    burstClicks,
    burstClickMs: Math.round(burstClickMs),
    burstEdits: [...suffix].length,
    burstTypingMs: Math.round(burstTypingMs),
  };
}
