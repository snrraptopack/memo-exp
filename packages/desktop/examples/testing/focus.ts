import {
  mountScene,
  sceneEvent,
  type DesktopApplication,
  type SceneElement,
  type SceneSnapshot,
  type SceneTemplate,
} from '@memoized-dom/desktop';
import type { DesktopProcessHost } from '@memoized-dom/desktop/host';

/** Drive compiled ordinary ref calls, with native observations kept in the test. */
export async function runAuthoredFocusSmoke(host: DesktopProcessHost, settleEvents: () => Promise<void>) {
  const waitFor = async (matches: (snapshot: SceneSnapshot) => boolean): Promise<SceneSnapshot> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await settleEvents();
      const snapshot = await host.inspect();
      if (snapshot.renderer?.error) throw new Error(snapshot.renderer.error);
      if (snapshot.renderer?.sequence === snapshot.sequence && matches(snapshot)) return snapshot;
      await Bun.sleep(15);
    }
    throw new Error('Ordinary authored ref focus did not settle');
  };
  const click = async (id: string) => {
    let snapshot = await waitFor(snapshot => snapshot.renderer!.boxes.some(box => box.id === id));
    const target = snapshot.renderer!.boxes.find(box => box.id === id)!;
    const viewport = snapshot.renderer!.scroll!.viewport;
    if (target.y + target.height <= 0 || target.y >= viewport) {
      await host.testWindow({ action: 'scroll', delta: viewport / 2 - target.y });
      const previousFrame = snapshot.renderer!.frames;
      snapshot = await waitFor(snapshot => snapshot.renderer!.frames > previousFrame);
    }
    await host.testWindow({ action: 'click', handle: target.handle, node: target.source });
  };
  await click('ref-focus');
  await waitFor(snapshot => {
    const input = snapshot.renderer!.boxes.find(box => box.id === 'ref-focus-editor');
    return !!input && snapshot.renderer!.focused?.handle.id === input.handle.id
      && snapshot.renderer!.focused!.node === input.source
      && snapshot.flow!.text_groups.some(group => group.text === 'Ref focus events: 1; blur events: 0');
  });
  await click('ref-blur');
  await waitFor(snapshot => snapshot.flow!.text_groups.some(group => group.text === 'Ref focus events: 1; blur events: 1'));
}

/** Check imperative refs against retained GPUI focus, events and platform input. */
export async function runFocusSmoke({ app, host, settleEvents }: {
  app: DesktopApplication;
  host: DesktopProcessHost;
  settleEvents(): Promise<void>;
}) {
  const template: SceneTemplate = {
    id: 'native-focus-capabilities',
    nodes: [
      { kind: 'element', tag: 'main', parent: null, text: '' },
      { kind: 'element', tag: 'input', parent: 0, text: '', attributes: { id: 'focus-input' } },
      { kind: 'element', tag: 'button', parent: 0, text: '' },
      { kind: 'element', tag: 'p', parent: 0, text: '' },
      { kind: 'text', parent: 2, text: 'Focus button' },
      { kind: 'text', parent: 3, text: 'Not a focus control' },
    ],
    slots: [],
    events: [
      { node: 1, type: 'focus' }, { node: 1, type: 'blur' },
      { node: 2, type: 'focus' }, { node: 2, type: 'blur' },
    ],
  };
  const events: string[] = [];
  let input!: SceneElement;
  let button!: SceneElement;
  let paragraph!: SceneElement;
  const owner = app.mount(() => mountScene(template, [], [
    sceneEvent(() => { events.push('input:focus'); }, []),
    sceneEvent(() => { events.push('input:blur'); }, []),
    sceneEvent(() => { events.push('button:focus'); }, []),
    sceneEvent(() => { events.push('button:blur'); }, []),
  ], {
    refs: [
      { node: 1, value(element) {
        input = element;
        // Exercise the gap between accepted mount and first control preparation.
        element.focus();
      } },
      { node: 2, value(element) { button = element; } },
      { node: 3, value(element) { paragraph = element; } },
    ],
  }));

  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
  };
  const focused = (snapshot: SceneSnapshot, node: number): boolean =>
    snapshot.renderer?.focused?.handle.id === owner.handle.id
      && snapshot.renderer.focused.node === node;
  const waitFor = async (matches: (snapshot: SceneSnapshot) => boolean): Promise<SceneSnapshot> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await settleEvents();
      const snapshot = await host.inspect();
      if (snapshot.renderer?.error) throw new Error(snapshot.renderer.error);
      if (snapshot.renderer?.sequence === snapshot.sequence && matches(snapshot)) return snapshot;
      await Bun.sleep(15);
    }
    throw new Error('Native ref focus did not reach the expected state');
  };

  try {
    await owner.ready;
    const initial = await waitFor(snapshot => focused(snapshot, 1) && events.length === 1);
    assert(input.focus() === undefined && button.blur() === undefined,
      'Author-facing focus/blur exposed native transport promises');
    // Inspection/measurement are test barriers, not application authoring APIs.
    await input.measure();
    await host.testInput(owner.handle, 1, 'insert', 'Native ref input');
    await waitFor(snapshot => focused(snapshot, 1)
      && snapshot.renderer!.inputs!.some(control => control.handle.id === owner.handle.id
        && control.node === 1 && control.text === 'Native ref input'));
    assert(events.join(',') === 'input:focus', 'Repeated focus or unrelated blur emitted false transitions');

    paragraph.focus();
    await paragraph.measure();
    assert(focused(await host.inspect(), 1), 'A nonfocusable paragraph displaced native input focus');
    const stale = await host.setFocus!({ ...owner.handle, generation: owner.handle.generation + 1 }, 1, true)
      .then(() => false, () => true);
    assert(stale, 'The native host focused a stale generation');
    button.focus();
    await waitFor(snapshot => focused(snapshot, 2) && events.length === 3);
    button.blur();
    const blurred = await waitFor(snapshot => snapshot.renderer!.focused === null && events.length === 4);
    assert(events.join(',') === 'input:focus,input:blur,button:focus,button:blur',
      'Imperative focus did not use the existing native focus event subscriptions');
    assert(blurred.sequence === initial.sequence, 'Imperative focus published an application transaction');
  } finally {
    await owner.dispose();
  }
  assert(input.focus() === undefined, 'A retired ref exposed a transport operation');
  return { nativeRefFocus: true, nativeRefBlur: true, focusEvents: events.length, initialRefFocus: true, voidFocusContract: true };
}
