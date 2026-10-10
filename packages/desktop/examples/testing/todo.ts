import type { SceneSnapshot } from '@memoized-dom/desktop';
import type { DesktopProcessHost } from '@memoized-dom/desktop/host';

/** Real native clicks and edits exercise the authored example and its callbacks. */
export async function runTodoSmoke({ host, waitForFrame, settleEvents }: {
  host: DesktopProcessHost;
  waitForFrame(sequence: number, afterFrame?: number): Promise<SceneSnapshot>;
  settleEvents(): Promise<void>;
}) {
  let snapshot = await waitForFrame(1);
  const box = (id: string, handle?: number) => {
    const value = snapshot.renderer!.boxes.find(item => item.id === id && (handle === undefined || item.handle.id === handle));
    if (!value) throw new Error(`Missing native todo box: ${id}`);
    return value;
  };
  const rows = () => snapshot.instances.filter(instance => instance.template.endsWith('#TodoRow'));
  const texts = () => snapshot.instances.flatMap(instance => instance.text_groups.map(group => group.text));
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const refresh = async () => { await settleEvents(); snapshot = await waitForFrame(snapshot.sequence + 1); };
  const click = async (id: string, handle?: number) => {
    let target = box(id, handle);
    const viewport = snapshot.renderer!.scroll!.viewport;
    if (target.y < 0 || target.y + target.height > viewport) {
      await host.testWindow({ action: 'scroll', delta: viewport / 2 - target.y - target.height / 2 });
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

  assert(rows().length === 3, 'Todo seed tasks did not mount');
  await host.testWindow({ action: 'resize', width: 1200, height: 800 });
  snapshot = await waitForFrame(snapshot.sequence, snapshot.renderer!.frames);
  const page = box('todo-page'); const workspace = box('todo-workspace');
  assert(workspace.width <= 961 && Math.abs(workspace.x - page.x - (page.width - workspace.width) / 2) <= 1, 'Todo workspace is not centered with max-width and auto margins');
  const stats = ['stat-total', 'stat-active', 'stat-done'].map(id => box(id));
  assert(stats.every(item => Math.abs(item.width - stats[0]!.width) <= 1 && Math.abs(item.y - stats[0]!.y) <= 1), 'Todo grid cards did not receive equal-width columns');
  await input('new-task', '静🙂 café');
  assert(texts().includes('Typing: 静🙂 café'), 'Typing did not update the authored preview');
  await click('add-task');
  assert(rows().length === 4 && texts().includes('静🙂 café'), 'Add did not insert the authored task');
  assert(texts().includes('Typing: '), 'Adding did not clear the native bound input');
  const added = rows().find(row => row.text_groups.some(group => group.text === 'Task #4'))!;
  await click('toggle-task', added.handle.id);
  assert(snapshot.instances.some(instance => instance.template.endsWith('#CompletedTitle') && instance.attach_to?.handle.id === added.handle.id), 'Row callback did not complete its parent-owned task');
  await click('toggle-task', added.handle.id);
  await input('row-note', 'retained note', added.handle.id);
  await click('reverse-tasks');
  assert(rows().find(row => row.handle.id === added.handle.id)?.text_groups.some(group => group.text === 'Note: retained note') === true, 'Reordering lost the keyed row note');
  await click('delete-task', added.handle.id);
  assert(rows().length === 3 && !rows().some(row => row.handle.id === added.handle.id), 'Delete did not retire the requested row');
  await click('filter-done'); assert(rows().length === 1, 'Completed filter did not select one task');
  await click('filter-all'); assert(rows().length === 3, 'All filter did not restore tasks');
  await click('clear-done'); assert(rows().length === 2, 'Clear completed did not remove the completed task');
  await click('add-samples'); assert(rows().length === 22, 'Scroll sample tasks did not mount');
  await host.testWindow({ action: 'resize', width: 500, height: 700 });
  snapshot = await waitForFrame(snapshot.sequence, snapshot.renderer!.frames);
  const narrow = box('todo-workspace');
  assert(narrow.width <= 437 && narrow.x >= 31, 'Narrow layout lost page gutters');
  for (const item of snapshot.renderer!.boxes) assert((item.x >= narrow.x - 1 && item.x + item.width <= narrow.x + narrow.width + 1) || item.id === 'todo-page', `Todo box overflows narrow workspace: ${item.tag} ${item.id}`);
  assert(box('add-task').y > box('new-task').y, 'Narrow editor did not wrap its add button');
  await host.testWindow({ action: 'scroll', delta: -100_000 });
  snapshot = await waitForFrame(snapshot.sequence, snapshot.renderer!.frames);
  const footer = box('todo-footer');
  assert(footer.y >= 0 && footer.y + footer.height <= snapshot.renderer!.scroll!.viewport + 1, 'Todo footer is not reachable by scrolling');
  const last = rows().at(-1)!;
  await click('delete-task', last.handle.id); assert(rows().length === 21, 'Native row click after scrolling did not delete');
  return { owners: snapshot.instances.length, tasks: rows().length, scrollMax: snapshot.renderer!.scroll!.max, frameMs: snapshot.renderer!.frame_ms };
}
