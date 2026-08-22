/**
 * SSR Slice 1.2 — RenderEnvironment capability descriptor.
 *
 * Behavior must be selected by explicit capabilities on the application
 * runtime, not `typeof window` probes. These tests prove:
 * - the browser default resolves to client-create with ambient globals;
 * - a server-shaped runtime (injected document, null schedule, effects
 *   disabled) renders structural anchors through the injected document,
 *   never schedules pull frames, and never executes effects;
 * - schedulers and environments are independent per runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commit,
  createApplicationRuntime,
  getActiveApplicationRuntime,
  getActiveEnvironment,
  register,
  registerEffect,
  resetScheduler,
  runWithApplicationRuntime,
  setActiveApplicationRuntime,
  setScheduler,
  unregister,
  type DocumentLike,
} from '@memoized-dom/runtime';

function makeStubDocument() {
  const created: string[] = [];
  const doc: DocumentLike = {
    createComment(data: string) {
      created.push(`comment:${data}`);
      return document.createComment(data);
    },
    createElement(tagName: string) {
      created.push(`element:${tagName}`);
      return document.createElement(tagName);
    },
    createDocumentFragment() {
      created.push('fragment');
      return document.createDocumentFragment();
    },
    getElementById(id: string) {
      return document.getElementById(id);
    },
  };
  return { doc, created };
}

describe('render environment capabilities', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    setScheduler((run) => run());
  });

  afterEach(() => {
    setActiveApplicationRuntime(getActiveApplicationRuntime());
    resetScheduler();
    vi.restoreAllMocks();
  });

  it('defaults to client-create with ambient capabilities', () => {
    const env = getActiveEnvironment();
    expect(env.mode).toBe('client-create');
    expect(env.effects).toBe('run');
    expect(env.refs).toBe('run');
    expect(typeof env.document.createElement).toBe('function');
  });

  it('runs effects in the client default', () => {
    let ran = false;
    registerEffect('EnvApp/$effects/0', null, () => {
      ran = true;
    });
    commit();
    expect(ran).toBe(true);
    unregister('EnvApp/$effects/0');
  });

  it('server runtime: structural anchors use the injected document', () => {
    const { doc, created } = makeStubDocument();
    const server = createApplicationRuntime('request-dom', {
      mode: 'server-dom',
      document: doc,
      schedule: null,
      effects: 'disabled',
      refs: 'disabled',
    });

    runWithApplicationRuntime(server, () => {
      // A conditional region creates its anchor through the environment
      // document — this is what compiled conds emit at creation time.
      const env2 = getActiveEnvironment().document;
      env2.createComment('when:probe');
      expect(created).toContain('comment:when:probe');
    });

    server.dispose();
  });

  it('server runtime: effects are recorded but never executed', () => {
    const { doc } = makeStubDocument();
    const server = createApplicationRuntime('request-fx', {
      mode: 'server-dom',
      document: doc,
      schedule: null,
      effects: 'disabled',
      refs: 'disabled',
    });

    let runs = 0;
    runWithApplicationRuntime(server, () => {
      registerEffect('FxApp/$effects/0', null, () => {
        runs++;
      });
      commit();
    });

    expect(runs).toBe(0);
    // The entity is still registered so structural ownership stays complete.
    expect(server.state.registry.has('FxApp/$effects/0')).toBe(true);

    // Switching back to a running environment does not retroactively run it.
    runWithApplicationRuntime(createApplicationRuntime('other'), () => {
      commit();
    });
    expect(runs).toBe(0);

    server.dispose();
  });

  it('volatile pulls are disabled when the runtime has no frame scheduler', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    const { doc } = makeStubDocument();
    const server = createApplicationRuntime('request-pull', {
      mode: 'server-dom',
      document: doc,
      schedule: null,
      effects: 'disabled',
      refs: 'disabled',
    });

    runWithApplicationRuntime(server, () => {
      register({
        id: 'Pull/Panel',
        parent: null,
        render: () => {},
        volatile: true,
      });
    });

    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
    server.dispose();
  });

  it('environments are independent per runtime', () => {    const { doc } = makeStubDocument();
    const server = createApplicationRuntime('request-env', {
      mode: 'server-dom',
      document: doc,
      schedule: null,
      effects: 'disabled',
      refs: 'disabled',
    });

    expect(getActiveEnvironment().mode).toBe('client-create');
    runWithApplicationRuntime(server, () => {
      expect(getActiveEnvironment().mode).toBe('server-dom');
      expect(getActiveEnvironment().schedule).toBeNull();
    });
    expect(getActiveEnvironment().mode).toBe('client-create');

    server.dispose();
  });
});
