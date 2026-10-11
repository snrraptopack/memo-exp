import { describe, expect, it } from 'bun:test';
import { createCondRegion } from '@memoized-dom/runtime';
import { createApplicationRuntime, runWithApplicationRuntime } from '@memoized-dom/runtime/testing';
import {
  createDesktopApplication,
  defineSceneComponent,
  mountScene,
  type SceneInstance,
  type SceneTemplate,
} from '../packages/desktop/src';

interface LifetimeFixture {
  select(branch: number): Promise<void>;
  identity(): unknown;
  setups: number[];
  retirements: number[];
  dispose(): Promise<void>;
}

/** Compare common ownership invariants; native acknowledgment remains host-owned. */
function domFixture(): LifetimeFixture {
  const runtime = createApplicationRuntime('structural-contract', { document, schedule: null });
  const host = document.createElement('main');
  document.body.append(host);
  const setups = [0, 0];
  const retirements = [0, 0];
  let selected = 0;
  const region = runWithApplicationRuntime(runtime, () =>
    createCondRegion(
      host,
      'structural-contract/region',
      () => selected,
      [0, 1].map((branch) => () => {
        setups[branch]++;
        const node = document.createElement('p');
        node.textContent = String(branch);
        return {
          nodes: [node],
          update() {},
          dispose() {
            retirements[branch]++;
          },
        };
      }),
    ),
  );

  return {
    setups,
    retirements,
    async select(branch) {
      selected = branch;
      runWithApplicationRuntime(runtime, () => region.update());
    },
    identity: () => host.querySelector('p'),
    async dispose() {
      runWithApplicationRuntime(runtime, () => region.dispose());
      runtime.dispose();
      host.remove();
    },
  };
}

async function desktopFixture(): Promise<LifetimeFixture> {
  const setups = [0, 0];
  const retirements = [0, 0];
  const instances = new Map<number, SceneInstance>();
  let selected = 0;
  const app = createDesktopApplication({
    async install() {},
    async commit(transaction) {
      return { sequence: transaction.sequence };
    },
  });
  const branches = [0, 1].map((branch) => {
    const template: SceneTemplate = {
      id: `structural-contract/${branch}`,
      nodes: [{ kind: 'text', parent: null, text: String(branch) }],
      slots: [],
      events: [],
    };
    const component = () => {
      setups[branch]++;
      const instance = mountScene(template, [], [], {
        cleanups: [
          () => {
            retirements[branch]++;
          },
        ],
      });
      instances.set(branch, instance);
      return instance;
    };
    defineSceneComponent(component, template, () => []);
    return component;
  });
  const template: SceneTemplate = {
    id: 'structural-contract/root',
    nodes: [{ kind: 'region', parent: null }],
    slots: [],
    events: [],
  };
  const root = app.mount(() =>
    mountScene(template, [], [], {
      components: branches,
      regions: [
        {
          node: 0,
          sources: ['selected'],
          branches,
          read: () => ({ branch: selected, props: {} }),
        },
      ],
    }),
  );
  await root.ready;

  return {
    setups,
    retirements,
    async select(branch) {
      selected = branch;
      root.invalidate(['selected']);
      await root.flush();
    },
    identity: () => (instances.get(selected)?.mounted ? instances.get(selected) : undefined),
    async dispose() {
      await app.dispose();
    },
  };
}

for (const [host, create] of [
  ['DOM', domFixture],
  ['desktop', desktopFixture],
] as const) {
  describe(`${host} structural ownership contract`, () => {
    it('retains the selected owner and leaves inactive setup untouched', async () => {
      const fixture = await create();
      try {
        const first = fixture.identity();
        await fixture.select(0);
        await fixture.select(0);
        expect(fixture.identity()).toBe(first);
        expect(fixture.setups).toEqual([1, 0]);
        expect(fixture.retirements).toEqual([0, 0]);
      } finally {
        await fixture.dispose();
      }
    });

    it('retires replaced owners once and recreates their state on reentry', async () => {
      const fixture = await create();
      try {
        const first = fixture.identity();
        await fixture.select(1);
        expect(fixture.identity()).not.toBe(first);
        expect(fixture.setups).toEqual([1, 1]);
        expect(fixture.retirements).toEqual([1, 0]);
        await fixture.select(0);
        expect(fixture.identity()).not.toBe(first);
        expect(fixture.setups).toEqual([2, 1]);
        expect(fixture.retirements).toEqual([1, 1]);
      } finally {
        await fixture.dispose();
      }
    });

    it('makes disposal terminal and suppresses late invalidations', async () => {
      const fixture = await create();
      await fixture.dispose();
      await fixture.dispose();
      await fixture.select(1);
      expect(fixture.setups).toEqual([1, 0]);
      expect(fixture.retirements).toEqual([1, 0]);
      expect(fixture.identity()).toBeFalsy();
    });
  });
}
