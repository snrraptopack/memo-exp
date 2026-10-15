/** Ordinary controlled input uses existing compiled callbacks and shared cells. */
import { expect, test } from 'bun:test';
import * as core from '@memoized-dom/runtime/core';
import { dispatchNativeEvent } from '../src/runtime/dispatch';
import { parseNativeEvent, type NativeEventPacket } from '../src/host/events';
import type { SourceReference } from '../src/host/protocol';
import { compiledOperations, createCompiledApplication, drainCompiled, moduleFactory } from './fixtures/compiled-application';

const keys = {
  key: 'Enter', code: 'Enter', location: 0, repeat: false, isComposing: false,
  altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
};

function event(source: SourceReference, value: string, revision: number): NativeEventPacket {
  return {
    kind: 'event', version: 1, dispatchId: revision, eventType: 'input',
    path: [source], cancelable: false, bubbles: true, timestamp: 0, sceneSequence: 1,
    control: { value, revision, isComposing: false },
  };
}

test('input packets require editor state and keyboard packets require ordinary key fields', () => {
  const source = { owner: { id: 'App', generation: 1 }, source: 0 };
  const input = event(source, 'typed', 1);
  expect(parseNativeEvent(input)).toEqual(input);
  expect(() => parseNativeEvent({ ...input, cancelable: true })).toThrow('payload');
  expect(() => parseNativeEvent({ ...input, control: undefined })).toThrow('payload');
  expect(() => parseNativeEvent({ ...input, control: { ...input.control, revision: -1 } })).toThrow('control');
  expect(() => parseNativeEvent({ ...input, eventType: 'keydown' })).toThrow('payload');
  expect(parseNativeEvent({ ...input, eventType: 'keydown', cancelable: true, keyboard: keys }).keyboard).toEqual(keys);
  expect(() => parseNativeEvent({ ...input, eventType: 'keyup', keyboard: { ...keys, location: 9 } })).toThrow('keyboard');
});

test.each([false, true])('typed values, Enter cancellation and clearing retain the native edit revision (nested=%s)', async nested => {
  const module = moduleFactory(`
    export function increment() {}
    function Editor() {
      let draft = '';
      let submitted = '';
      return <section>
        <input data-action="draft" value={draft}
          onInput={event => { draft = event.currentTarget.value; }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              submitted = draft;
              draft = '';
            }
          }} />
        <p>{draft}</p><strong>{submitted}</strong>
      </section>;
    }
    export function App() { return ${nested ? '<div>{[1].map(id => <Editor key={id} />)}</div>' : '<Editor />'}; }
  `);
  const fixture = createCompiledApplication(module);

  try {
    const mounted = fixture.candidate.publish(fixture.view.initialPublication);
    fixture.transport.accept(1);
    await mounted;
    const source = compiledOperations(fixture).find(operation =>
      operation.op === 'setAttribute' && operation.name.local === 'data-action' && operation.value === 'draft');
    if (source?.op !== 'setAttribute') throw new Error('Missing input source');

    let before = fixture.transport.sent.length;
    for (const [revision, value] of [[1, 'B'], [2, 'Buy milk']] as const) {
      const input = event(source.target, value, revision);
      expect(dispatchNativeEvent(fixture.view, input, error => { throw error; })).toBe(false);
      fixture.application.run(core.commit);
      await drainCompiled(fixture, before);
      const changes = compiledOperations(fixture, before);
      expect(changes.some(operation => operation.op === 'text' && operation.value === value)).toBe(true);
      expect(changes.some(operation => operation.op === 'setValue' && operation.revision !== revision)).toBe(false);
      before = fixture.transport.sent.length;
    }

    const enter = { ...event(source.target, 'Buy milk', 2), eventType: 'keydown' as const, cancelable: true, keyboard: keys };
    expect(dispatchNativeEvent(fixture.view, {
      ...enter, control: { value: 'Buy milk', revision: 2, isComposing: true },
    }, error => { throw error; })).toBe(false);
    fixture.application.run(core.commit);
    expect(fixture.transport.sent).toHaveLength(before);
    expect(dispatchNativeEvent(fixture.view, enter, error => { throw error; })).toBe(true);
    fixture.application.run(core.commit);
    expect(fixture.view.controlledValues()).toEqual([
      expect.objectContaining({ op: 'setValue', target: source.target, value: '', revision: 2 }),
    ]);
    await drainCompiled(fixture, before);
    const changes = compiledOperations(fixture, before);
    expect(changes.some(operation => operation.op === 'text' && operation.value === 'Buy milk')).toBe(true);
    expect(changes.some(operation => operation.op === 'setValue' && operation.value === '' && operation.revision === 2)).toBe(true);
    // Acceptance releases the correction; subsequent decisions do not repeat it.
    expect(fixture.view.controlledValues()).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});

test('controlled corrections stay current while all scene credits are occupied', async () => {
  const module = moduleFactory(`
    let count = 0;
    export function increment() { count++; }
    export function App() {
      let draft = '';
      return <main><p>{count}</p>
        <input data-action="draft" value={draft}
          onInput={event => { draft = event.currentTarget.value; }}
          onKeyDown={event => { event.preventDefault(); draft = ''; }} />
      </main>;
    }
  `);
  const fixture = createCompiledApplication(module);
  try {
    const mounted = fixture.candidate.publish(fixture.view.initialPublication);
    fixture.transport.accept(1);
    await mounted;
    const source = compiledOperations(fixture).find(operation =>
      operation.op === 'setAttribute' && operation.value === 'draft');
    if (source?.op !== 'setAttribute') throw new Error('Missing input');
    dispatchNativeEvent(fixture.view, event(source.target, 'typed', 1), error => { throw error; });
    fixture.application.run(core.commit);
    await drainCompiled(fixture, 1);
    const before = fixture.transport.sent.length;
    for (let index = 0; index < 8; index++) {
      fixture.application.run(() => { fixture.module.increment(); core.commit(); });
    }
    expect(dispatchNativeEvent(fixture.view, {
      ...event(source.target, 'typed', 1), eventType: 'keydown', keyboard: keys, cancelable: true,
    }, error => { throw error; })).toBe(true);
    fixture.application.run(core.commit);
    expect(fixture.view.controlledValues()).toEqual([
      expect.objectContaining({ op: 'setValue', target: source.target, value: '', revision: 1 }),
    ]);
    await drainCompiled(fixture, before);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.application.close();
  }
});
