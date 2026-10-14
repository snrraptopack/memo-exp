import { describe, expect, test } from 'bun:test';
import {
  cleanup, commit, defineStateCell, getActiveApplicationRuntime, installAccessTable,
  invalidateEntity, mountRef, readCell, readPreparationScope, refAssign,
  registerEffect, registerEntity, setScheduler, updateCell,
  unregisterSubtree,
} from '@memoized-dom/runtime/core';
import { _propsBox } from '@memoized-dom/runtime/testing';
import { NativeApplication } from '../src/runtime/application';
import { PublicationClient } from '../src/host/client';
import {
  bindViewProps,
  child,
  NativeView,
  type NativeFrame,
} from '../src/runtime/view';
import { ManualTransport } from './fixtures/manual-transport';

function createApplication(transport = new ManualTransport()) {
  const errors: unknown[] = [];
  const client = new PublicationClient(transport);
  const application = new NativeApplication(client, {
    scheduleFrame: null,
    visible: () => true,
    reportError: error => errors.push(error),
  });
  application.run(() => setScheduler(() => {}));
  return { application, client, transport, errors };
}

function trackedCandidate(application: NativeApplication, id: string, events: string[]) {
  let connected = false;
  let assigned = false;
  const target = { get isConnected() { return connected; } };
  const candidate = application.prepare(() => {
    registerEntity({ id, parent: null, render() {} });
    cleanup(id, () => events.push(id + ':owned-cleanup'));
    cleanup(id, mountRef(target, refAssign(value => {
      assigned = true;
      events.push(id + ':ref');
      expect(value.isConnected).toBe(true);
      return () => {
        assigned = false;
        events.push(id + ':ref-cleanup');
      };
    })));
    registerEffect(id + '/effect', id, () => {
      expect(assigned).toBe(true);
      expect(connected).toBe(true);
      events.push(id + ':effect');
      return () => { events.push(id + ':effect-cleanup'); };
    });
    return target;
  }, {
    accepted() { connected = true; },
    disposed() {
      connected = false;
      events.push(id + ':host-disposed');
    },
  });
  return { candidate, target, assigned: () => assigned };
}

const empty = { operations: [] } as const;
function observe(promise: Promise<unknown>) {
  return promise.then(value => value, error => error);
}

describe('native publication uses shared core lifetimes', () => {
  test('refs and effects activate only after acceptance, in core order', async () => {
    const { application, transport, errors } = createApplication();
    const events: string[] = [];
    const view = trackedCandidate(application, 'App', events);
    application.run(commit);
    const published = view.candidate.publish(empty);
    application.run(commit);
    expect(events).toEqual([]);
    expect(view.assigned()).toBe(false);
    expect(view.target.isConnected).toBe(false);
    transport.accept(1);
    await published;
    application.run(commit);
    expect(events).toEqual(['App:ref', 'App:effect']);
    expect(view.candidate.status).toBe('active');
    expect(errors).toEqual([]);
    application.close();
    expect(view.assigned()).toBe(false);
    expect(view.target.isConnected).toBe(false);
  });

  test('refused replacement discards only its candidate and preserves accepted ownership', async () => {
    const { application, transport } = createApplication();
    const events: string[] = [];
    const old = trackedCandidate(application, 'Old', events);
    const mounted = old.candidate.publish(empty);
    transport.accept(1);
    await mounted;
    application.run(commit);
    const next = trackedCandidate(application, 'Next', events);
    const rejected = observe(next.candidate.publish(empty));
    transport.refuse(2);
    expect(await rejected).toMatchObject({ name: 'PublicationRefusedError' });
    expect(next.candidate.status).toBe('disposed');
    expect(events).not.toContain('Next:ref');
    expect(events).not.toContain('Next:effect');
    expect(events).toContain('Next:owned-cleanup');
    expect(old.candidate.status).toBe('active');
    expect(old.assigned()).toBe(true);
    expect(application.isClosed).toBe(false);
    application.close();
  });

  test('only accepted retirement releases old refs/effects, exactly once', async () => {
    const { application, transport } = createApplication();
    const events: string[] = [];
    const view = trackedCandidate(application, 'App', events);
    const mounted = view.candidate.publish(empty);
    transport.accept(1);
    await mounted;
    application.run(commit);
    const refused = observe(view.candidate.retire(empty));
    transport.refuse(2);
    expect(await refused).toMatchObject({ name: 'PublicationRefusedError' });
    expect(view.candidate.status).toBe('active');
    expect(view.assigned()).toBe(true);
    const retired = view.candidate.retire(empty);
    expect(view.assigned()).toBe(true);
    transport.accept(2);
    await retired;
    expect(view.candidate.status).toBe('disposed');
    expect(view.target.isConnected).toBe(false);
    expect(events.slice(2)).toEqual([
      'App:host-disposed', 'App:effect-cleanup', 'App:ref-cleanup', 'App:owned-cleanup',
    ]);
    application.close();
    expect(events.filter(value => value === 'App:ref-cleanup')).toHaveLength(1);
  });

  test('existing access tables/cells drive updates and refused effects wait for correction', async () => {
    const { application, transport } = createApplication();
    const cell = defineStateCell('native-lifecycle#count', 0);
    const values: number[] = [];
    const updates: Promise<unknown>[] = [];
    const candidate = application.prepare(() => {
      registerEntity({
        id: 'App', parent: null,
        render() { updates.push(observe(application.publishUpdates(empty))); },
      });
      installAccessTable({ readers: { [cell.key]: ['App', 'App/effect'] } }, 'App', 'lifecycle-table');
      registerEffect('App/effect', 'App', () => { values.push(readCell<number>(cell)); });
    });
    const mounted = candidate.publish(empty);
    transport.accept(1);
    await mounted;
    application.run(commit);
    expect(values).toEqual([0]);
    application.run(() => { updateCell<number>(cell, value => value + 1); commit(); });
    expect(values).toEqual([0]);
    transport.refuse(2);
    expect(await updates[0]).toMatchObject({ name: 'PublicationRefusedError' });
    expect(values).toEqual([0]);
    const corrected = application.publishUpdates(empty);
    transport.accept(2);
    await corrected;
    expect(values).toEqual([0, 1]);
    application.close();
  });

  test('effects wait for the latest queued accepted scene and coalesce by existing entity', async () => {
    const { application, transport } = createApplication();
    let value = 0;
    const effects: number[] = [];
    const candidate = application.prepare(() => {
      registerEntity({ id: 'App', parent: null, render() {} });
      registerEffect('App/effect', 'App', () => { effects.push(value); });
    });
    const mounted = candidate.publish(empty);
    transport.accept(1);
    await mounted;
    application.run(commit);
    const first = application.publishUpdates(empty);
    const latest = application.publishUpdates(empty);
    application.run(() => {
      value = 2;
      invalidateEntity('App/effect');
      commit();
    });
    transport.accept(2);
    await first;
    expect(effects).toEqual([0]);
    transport.accept(3);
    await latest;
    expect(effects).toEqual([0, 2]);
    application.close();
  });

  test('template declarations are connection-owned and refused keys can be retried', async () => {
    const { application, transport } = createApplication();
    const firstTemplate = {
      key: 'shared-card',
      nodes: [{
        parent: null,
        node: { kind: 'text' as const, value: 'card' },
      }],
    };
    const nextTemplate = {
      key: 'retry-card',
      nodes: [{
        parent: null,
        node: { kind: 'text' as const, value: 'retry' },
      }],
    };

    const first = application.publishUpdates({
      templates: [firstTemplate],
      operations: [],
    });
    const queued = application.publishUpdates({
      templates: [firstTemplate],
      operations: [],
    });

    expect(JSON.parse(transport.sent[0]!).templates).toEqual([firstTemplate]);
    transport.accept(1);
    await first;
    await Bun.sleep(0);
    expect(JSON.parse(transport.sent[1]!).templates).toBeUndefined();
    transport.accept(2);
    await queued;

    const refused = observe(application.publishUpdates({
      templates: [nextTemplate],
      operations: [],
    }));

    transport.refuse(3);
    expect(await refused).toMatchObject({ name: 'PublicationRefusedError' });

    const retried = application.publishUpdates({
      templates: [nextTemplate],
      operations: [],
    });

    expect(JSON.parse(transport.sent[3]!).templates).toEqual([nextTemplate]);
    transport.accept(3);
    await retried;
    application.close();
  });

  test('staged view replacement preserves the live core until native acceptance', async () => {
    const { application, transport } = createApplication();
    const ownerId = 'App/when0/Content';
    const childId = `${ownerId}/Leaf`;
    const regionTemplate = {
      key: 'conditional-content',
      nodes: [{
        parent: null,
        node: { kind: 'comment' as const, value: 'content' },
      }],
    };
    const leafTemplate = {
      key: 'conditional-leaf',
      nodes: [{
        parent: null,
        node: { kind: 'text' as const, value: '' },
      }],
    };

    function frame(generation: number, deferCore = false): NativeFrame {
      return {
        application,
        owner: { id: ownerId, generation },
        parent: 'App/when0',
        reportError() {},
        deferCore,
      };
    }

    function view(generation: number, label: string, deferCore = false): NativeView {
      const result = new NativeView(
        frame(generation, deferCore),
        regionTemplate,
        () => [],
        [
          child('Leaf', 0, (childFrame) => {
            const leaf = new NativeView(
              childFrame,
              leafTemplate,
              () => [{ kind: 'text', source: 0, value: label }],
            );

            bindViewProps(leaf, [`${label}-leaf`]);
            return leaf;
          }),
        ],
      );

      bindViewProps(result, [label]);
      return result;
    }

    application.run(() => {
      registerEntity({ id: 'App/when0', parent: null, render() {} });
    });

    const current = application.run(() => view(1, 'current'));
    expect(current.initialPublication.operations).toHaveLength(3);
    current.acceptInitial();

    const currentEntity = application.runtime.state.registry.get(ownerId);
    const currentChildEntity = application.runtime.state.registry.get(childId);
    expect(currentEntity).toBeDefined();
    expect(currentChildEntity).toBeDefined();
    expect(application.run(() => _propsBox(ownerId))).toEqual(['current']);
    expect(application.run(() => _propsBox(childId))).toEqual(['current-leaf']);

    const refused = application.run(() => view(2, 'refused', true));
    const refusedPublication = refused.initialPublication;
    const refusal = observe(application.publish({
      templates: refusedPublication.templates,
      operations: [
        { op: 'retire', owner: { id: ownerId, generation: 1 } },
        ...refusedPublication.operations,
      ],
    }, () => {
      throw new Error('A refused transaction must not activate its staged core');
    }));

    expect(application.runtime.state.registry.get(ownerId)).toBe(currentEntity);
    expect(application.runtime.state.registry.get(childId)).toBe(currentChildEntity);
    expect(application.run(() => _propsBox(ownerId))).toEqual(['current']);
    expect(application.run(() => _propsBox(childId))).toEqual(['current-leaf']);

    transport.refuse(1);
    expect(await refusal).toMatchObject({ name: 'PublicationRefusedError' });
    application.run(() => refused.discardStaged());

    expect(application.runtime.state.registry.get(ownerId)).toBe(currentEntity);
    expect(application.runtime.state.registry.get(childId)).toBe(currentChildEntity);
    expect(application.run(() => _propsBox(ownerId))).toEqual(['current']);
    expect(application.run(() => _propsBox(childId))).toEqual(['current-leaf']);

    const replacement = application.run(() => view(2, 'replacement', true));
    const replacementPublication = replacement.initialPublication;
    const accepted = application.publish({
      templates: replacementPublication.templates,
      operations: [
        { op: 'retire', owner: { id: ownerId, generation: 1 } },
        ...replacementPublication.operations,
      ],
    }, () => {
      unregisterSubtree(ownerId);
      replacement.attachCore();
      replacement.acceptInitial();
      replacement.activateUpdates();
    });

    expect(application.runtime.state.registry.get(ownerId)).toBe(currentEntity);
    expect(application.runtime.state.registry.get(childId)).toBe(currentChildEntity);
    expect(application.run(() => _propsBox(ownerId))).toEqual(['current']);
    expect(application.run(() => _propsBox(childId))).toEqual(['current-leaf']);

    transport.accept(1);
    await accepted;

    expect(application.runtime.state.registry.get(ownerId)).not.toBe(currentEntity);
    expect(application.runtime.state.registry.get(childId)).not.toBe(currentChildEntity);
    expect(application.run(() => _propsBox(ownerId))).toEqual(['replacement']);
    expect(application.run(() => _propsBox(childId))).toEqual(['replacement-leaf']);
    application.close();
  });

  test('idle connection loss tears down accepted owners and reports once', async () => {
    const { application, transport, errors } = createApplication();
    const events: string[] = [];
    const view = trackedCandidate(application, 'App', events);
    const mounted = view.candidate.publish(empty);
    transport.accept(1);
    await mounted;
    application.run(commit);
    transport.observer!.failure(new Error('native host disappeared'));
    expect(application.isClosed).toBe(true);
    expect(view.assigned()).toBe(false);
    expect(view.candidate.status).toBe('disposed');
    expect(application.runtime.state.registry.size).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'acceptanceUnknown' });
    application.close();
    expect(errors).toHaveLength(1);
  });

  test('an effect failure after accepted update drains ownership and closes the host', async () => {
    const { application, transport, errors } = createApplication();
    const events: string[] = [];
    const view = trackedCandidate(application, 'App', events);
    let failEffect = false;
    application.run(() => registerEffect('App/failing', 'App', () => {
      if (failEffect) throw new Error('accepted effect failed');
    }));

    const mounted = view.candidate.publish(empty);
    transport.accept(1);
    await mounted;
    application.run(commit);

    const update = observe(application.publishUpdates(empty));
    application.run(() => {
      failEffect = true;
      invalidateEntity('App/failing');
      commit();
    });
    expect(application.isClosed).toBe(false);

    transport.accept(2);
    expect(await update).toMatchObject({ message: 'accepted effect failed' });
    expect(application.isClosed).toBe(true);
    expect(view.assigned()).toBe(false);
    expect(view.candidate.status).toBe('disposed');
    expect(application.runtime.state.registry.size).toBe(0);
    expect(errors).toHaveLength(1);
  });

  test('close before acknowledgment prevents late ref/effect activation', async () => {
    const { application, transport } = createApplication();
    const events: string[] = [];
    const view = trackedCandidate(application, 'App', events);
    const pending = observe(view.candidate.publish(empty));
    const observer = transport.observer!;
    application.close();
    observer.reply({ version: 1, status: 'accepted', sequence: 1 });
    expect(await pending).toMatchObject({ code: 'closed' });
    expect(view.candidate.status).toBe('disposed');
    expect(events).not.toContain('App:ref');
    expect(events).not.toContain('App:effect');
  });

  test('build errors roll back through shared preparation without I/O', () => {
    const { application, transport } = createApplication();
    const events: string[] = [];
    expect(() => application.prepare(() => {
      registerEntity({ id: 'Broken', parent: null, render() {} });
      cleanup('Broken', () => events.push('rollback'));
      throw new Error('authored render failed');
    }, { disposed() { events.push('host-disposed'); } })).toThrow('authored render failed');
    expect(events).toEqual(['rollback', 'host-disposed']);
    expect(transport.sent).toHaveLength(0);
    expect(application.runtime.state.registry.size).toBe(0);
    expect(application.isClosed).toBe(false);
    application.close();
  });

  test('core-owned consumed resource readiness prevents early publication', async () => {
    const { application, transport } = createApplication();
    let settled = false;
    let notify!: () => void;
    let unsubscribed = 0;
    const resource = {
      key: {},
      snapshot: () => ({ status: settled ? 'ready' as const : 'pending' as const }),
      subscribe(listener: () => void) {
        notify = listener;
        return () => { unsubscribed++; };
      },
    };
    const candidate = application.prepare(scope => {
      registerEntity({ id: 'App', parent: null, render() {} });
      readPreparationScope('App', 'resource', () => scope.consume(resource));
    });
    expect(await observe(candidate.publish(empty))).toMatchObject({ code: 'candidateNotReady' });
    expect(transport.sent).toHaveLength(0);
    settled = true;
    notify();
    application.run(commit);
    const mounted = candidate.publish(empty);
    transport.accept(1);
    await mounted;
    expect(unsubscribed).toBe(1);
    expect(candidate.status).toBe('active');
    application.close();
  });

  test('canonical cells stay isolated between application runtimes', () => {
    const first = createApplication();
    const second = createApplication();
    const cell = defineStateCell('native-lifecycle-isolated#count', 0);
    first.application.run(() => updateCell<number>(cell, value => value + 1));
    expect(first.application.run(() => readCell<number>(cell))).toBe(1);
    expect(second.application.run(() => readCell<number>(cell))).toBe(0);
    const ambient = getActiveApplicationRuntime();
    first.application.close();
    second.application.close();
    expect(getActiveApplicationRuntime()).toBe(ambient);
  });

  test('accepted activation failure closes the host and drains throwing cleanup', async () => {
    const { application, transport, errors } = createApplication();
    const cleaned: string[] = [];
    const candidate = application.prepare(() => {
      registerEntity({ id: 'App', parent: null, render() {} });
      cleanup('App', () => { cleaned.push('first'); });
      cleanup('App', () => { cleaned.push('throwing'); throw new Error('cleanup failed'); });
      mountRef({ isConnected: true }, refAssign(() => { throw new Error('ref failed'); }));
    });
    const pending = observe(candidate.publish(empty));
    transport.accept(1);
    expect(await pending).toBeInstanceOf(Error);
    expect(application.isClosed).toBe(true);
    expect(transport.disposed).toBe(true);
    expect(cleaned).toEqual(['throwing', 'first']);
    expect(errors).toHaveLength(1);
    expect(application.runtime.state.registry.size).toBe(0);
  });
});
