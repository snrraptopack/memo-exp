import type { SceneSnapshot } from '@memoized-dom/desktop';
import type { DesktopProcessHost } from '@memoized-dom/desktop/host';

/** Check shared core semantics through actual native clicks, edits, and paint. */
export async function runReactivitySmoke({
  host,
  waitForFrame,
  settleEvents,
}: {
  host: DesktopProcessHost;
  waitForFrame(sequence: number, afterFrame?: number): Promise<SceneSnapshot>;
  settleEvents(): Promise<void>;
}) {
  let snapshot = await waitForFrame(1);
  const initialReaders = readerHandles(snapshot);

  async function waitForState(count: number, title?: string): Promise<void> {
    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
      await settleEvents();
      const next = await host.inspect();
      if (next.renderer?.error) throw new Error(next.renderer.error);

      const readers = next.instances.filter((owner) => owner.template.endsWith('#Readout'));
      const painted = next.renderer && next.renderer.sequence >= next.sequence;
      const parity = count % 2 === 0 ? 'Even' : 'Odd';
      const settled =
        readers.length === 2 &&
        readers.every((owner) => {
          const texts = owner.text_groups.map((group) => group.text);

          return (
            texts.includes(`Count: ${count}`) &&
            texts.includes(`Derived double: ${count * 2}`) &&
            texts.includes(`Component calculation: ${parity}`) &&
            texts.includes(`Accepted effect: count ${count}, native tag P`) &&
            (title === undefined || texts.includes(title))
          );
        });

      if (painted && settled) {
        if (readerHandles(next) !== initialReaders) {
          throw new Error('Shared state updates replaced the native readout owners');
        }

        snapshot = next;
        return;
      }

      await Bun.sleep(10);
    }

    throw new Error(`Native shared state did not settle at count ${count}`);
  }

  function box(id: string) {
    const target = snapshot.renderer!.boxes.find((item) => item.id === id);
    if (!target) throw new Error(`Missing native shared-state control: ${id}`);
    return target;
  }

  async function click(id: string): Promise<void> {
    let target = box(id);
    const viewport = snapshot.renderer!.scroll!.viewport;

    if (target.y < 0 || target.y + target.height > viewport) {
      await host.testWindow({
        action: 'scroll',
        delta: viewport / 2 - target.y - target.height / 2,
      });

      snapshot = await waitForFrame(snapshot.sequence, snapshot.renderer!.frames);
      target = box(id);
    }

    await host.testWindow({ action: 'click', handle: target.handle, node: target.source });
    await settleEvents();
  }

  await waitForState(0);
  await click('shared-increment');
  await waitForState(1);

  // Observe the first segment before the 500 ms await finishes. Checking only
  // the final count would miss a regression that delays the whole callback.
  await click('phased-increment');
  await waitForState(2);
  await waitForState(3);

  await click('delayed-increment');
  await waitForState(4);

  const title = 'Native shared title 静🙂';
  const input = box('shared-title');
  await host.testInput(input.handle, input.source, 'select-all');
  await host.testInput(input.handle, input.source, 'insert', title);
  await waitForState(4, title);

  return {
    owners: snapshot.instances.length,
    readers: 2,
    count: 4,
    title,
    asyncSegments: [2, 3],
    acceptedRefTag: 'P',
    frames: snapshot.renderer!.frames,
  };
}

function readerHandles(snapshot: SceneSnapshot): string {
  return snapshot.instances
    .filter((owner) => owner.template.endsWith('#Readout'))
    .map((owner) => `${owner.handle.id}:${owner.handle.generation}`)
    .sort()
    .join(',');
}
