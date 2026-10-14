import { build } from 'esbuild';
import { expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as core from '../packages/runtime/src/core';
import { createApplicationRuntime as sharedRuntime } from '../packages/runtime/src/kernel';
import { createRenderPreparation as sharedPreparation } from '../packages/runtime/src/preparation';
import { uninstallAccessTable } from '../packages/runtime/src/access';
import { computedChanged as domComparison } from '../packages/runtime/src/setters';
import { rootFactoryStore as browserRootFactoryStore } from '../packages/runtime/src/mount-core';

it('shares browser root metadata without a second host registry', () => {
  expect(core.rootFactoryStore()).toBe(browserRootFactoryStore());
  const component = () => undefined;
  const definition = { id: 'RegistryParity', create: () => document.createTextNode('shared') };
  browserRootFactoryStore().set(component, definition);
  expect(core.rootFactoryStore().get(component)).toBe(definition);
  core.rootFactoryStore().delete(component);
});

it('exports the same semantic implementations without importing a rendering host', async () => {
  expect(core.createApplicationRuntime).toBe(sharedRuntime);
  expect(core.createRenderPreparation).toBe(sharedPreparation);
  expect(core.computedChanged).toBe(domComparison);

  const bundled = await build({
    entryPoints: [resolve(import.meta.dirname, '../packages/runtime/src/core.ts')],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
  });
  const inputs = Object.keys(bundled.metafile!.inputs).map(path => path.replaceAll('\\', '/'));

  for (const name of ['index', 'server', 'mount', 'hydration', 'markup', 'list', 'list-dom', 'setters', 'dom-values', 'dom-props']) {
    expect(inputs.some(path => path.endsWith(`/src/${name}.ts`))).toBe(false);
  }
  expect(bundled.outputFiles[0]!.text).not.toContain('node:async_hooks');
});

it('creates and runs a core application in a process without document globals', async () => {
  const entry = pathToFileURL(resolve(import.meta.dirname, '../packages/runtime/src/core.ts')).href;
  const program = `
    if (typeof document !== 'undefined') throw new Error('Unexpected DOM preload');
    const core = await import(${JSON.stringify(entry)});
    const runtime = core.createApplicationRuntime('no-document', { schedule: null });
    core.runWithApplicationRuntime(runtime, () => {
      core.setScheduler(() => {});
      let renders = 0;
      core.registerEntity({ id: 'Root', parent: null, render() { renders++; } });
      core.invalidateEntity('Root');
      core.commit();
      if (renders !== 1) throw new Error('Shared core did not render');
      core.runWithRenderEnvironment({ effects: 'disabled' }, () => {
        if (core.getActiveEnvironment().effects !== 'disabled') throw new Error('Scope lost');
      });
      let refused = false;
      try { core.getActiveEnvironment().document; } catch { refused = true; }
      if (!refused) throw new Error('Core fabricated a browser document');
    });
    runtime.dispose();
    console.log('core-without-document');
  `;
  // A temporary working directory avoids the root test runner's DOM preload.
  const child = Bun.spawn([process.execPath, '-e', program], {
    cwd: tmpdir(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [output, errors, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(errors).toBe('');
  expect(status).toBe(0);
  expect(output.trim()).toBe('core-without-document');
});

it('routes canonical cell writes with the existing access resolver and application isolation', () => {
  const first = core.createApplicationRuntime('native-cell-first', { schedule: null });
  const second = core.createApplicationRuntime('native-cell-second', { schedule: null });
  const cell = core.defineStateCell('./native-core/state.ts#count', 0);
  const observed: number[] = [];
  const owner = 'native-core-cell-table';

  try {
    core.runWithApplicationRuntime(first, () => {
      core.setScheduler(() => {});
      core.registerEntity({
        id: 'NativeCore/Counter',
        parent: null,
        render() { observed.push(core.readCell<number>(cell)); },
      });
      core.installAccessTable({ readers: { [cell.key]: ['NativeCore/Counter'] } }, 'NativeCore', owner);
      core.updateCell<number>(cell, value => value + 1);
      core.commit();
      expect(observed).toEqual([1]);
      uninstallAccessTable(owner);
    });
    core.runWithApplicationRuntime(second, () => {
      expect(core.readCell<number>(cell)).toBe(0);
    });
  } finally {
    first.dispose();
    second.dispose();
  }
});

it('uses native visibility for opaque pulls without reading a document capability', () => {
  const frames: Array<() => void> = [];
  let visible = false;
  let renders = 0;
  const runtime = core.createApplicationRuntime('native-visible', {
    get document() { throw new Error('Native pulls accessed document'); },
    schedule: frame => frames.push(frame),
    visible: () => visible,
  });

  try {
    core.runWithApplicationRuntime(runtime, () => {
      core.setScheduler(run => run());
      core.register({ id: 'NativePull', parent: null, volatile: true, render() { renders++; } });
    });
    frames.shift()!();
    expect(renders).toBe(0);
    visible = true;
    frames.shift()!();
    expect(renders).toBe(1);
    runtime.dispose();
    frames.shift()!();
    expect(frames).toHaveLength(0);
  } finally {
    runtime.dispose();
  }
});

it('holds effects at host acceptance and ignores retired registrations with reused IDs', () => {
  const pending = new Map<string, () => void>();
  const events: string[] = [];
  const runtime = core.createApplicationRuntime('native-effects', {
    schedule: null,
    effectBoundary(id, execute) { pending.set(id, execute); },
  });
  const ambient = core.getActiveApplicationRuntime();

  try {
    core.runWithApplicationRuntime(runtime, () => {
      core.setScheduler(() => {});
      core.registerEffect('NativeEffect', null, () => {
        expect(core.getActiveApplicationRuntime()).toBe(runtime);
        events.push('old');
      });
      core.commit();
    });
    expect(events).toEqual([]);
    const retired = pending.get('NativeEffect')!;

    core.runWithApplicationRuntime(runtime, () => {
      core.registerEffect('NativeEffect', null, () => {
        expect(core.getActiveApplicationRuntime()).toBe(runtime);
        events.push('accepted');
        return () => { events.push('cleanup'); };
      });
      core.commit();
    });
    retired();
    expect(events).toEqual([]);
    pending.get('NativeEffect')!();
    expect(events).toEqual(['accepted']);
    expect(core.getActiveApplicationRuntime()).toBe(ambient);
    runtime.dispose();
    pending.get('NativeEffect')!();
    expect(events).toEqual(['accepted', 'cleanup']);
  } finally {
    runtime.dispose();
  }
});

it('defers conditional effect transitions and discards a retired activation controller', () => {
  const pending = new Map<string, () => void>();
  const events: string[] = [];
  let active = true;
  let conditionReads = 0;
  const runtime = core.createApplicationRuntime('native-condition', {
    schedule: null,
    effectBoundary(id, execute) { pending.set(id, execute); },
  });

  try {
    core.runWithApplicationRuntime(runtime, () => {
      core.setScheduler(() => {});
      core.registerConditionalEffect('Gate', null, () => {
        conditionReads++;
        return active;
      }, () => {
        events.push('start');
        return () => { events.push('stop'); };
      });
      core.commit();
    });
    pending.get('Gate')!();
    core.runWithApplicationRuntime(runtime, core.commit);
    expect(events).toEqual([]);
    pending.get('Gate/$active')!();
    expect(events).toEqual(['start']);

    core.runWithApplicationRuntime(runtime, () => {
      active = false;
      core.invalidateEntity('Gate');
      core.commit();
    });
    expect(events).toEqual(['start']);
    pending.get('Gate')!();
    expect(events).toEqual(['start', 'stop']);

    const retired = pending.get('Gate')!;
    const previousReads = conditionReads;
    core.runWithApplicationRuntime(runtime, () => {
      core.registerConditionalEffect('Gate', null, () => true, () => { events.push('replacement'); });
      core.commit();
    });
    retired();
    expect(conditionReads).toBe(previousReads);
    expect(events).toEqual(['start', 'stop']);
  } finally {
    runtime.dispose();
  }
});

it('runs shared refs on native targets without ownerDocument and keeps reverse cleanup', () => {
  const runtime = core.createApplicationRuntime('native-refs', { schedule: null });
  const events: string[] = [];
  const target = { isConnected: true };

  try {
    core.runWithApplicationRuntime(runtime, () => {
      const dispose = core.mountRef(target, [
        core.refAssign(node => {
          expect(node).toBe(target);
          events.push('assign');
          return () => { events.push('clear'); };
        }),
        () => {
          events.push('callback');
          return () => { events.push('callback-cleanup'); };
        },
      ]);
      expect(events).toEqual(['assign', 'callback']);
      dispose();
      dispose();
      expect(events).toEqual(['assign', 'callback', 'callback-cleanup', 'clear']);
    });
  } finally {
    runtime.dispose();
  }
});

it('inherits host hooks in scoped environments and permits explicit removal', () => {
  const visible = () => false;
  const effectBoundary = () => {};
  const runtime = core.createApplicationRuntime('native-environment-scope', {
    schedule: null,
    visible,
    effectBoundary,
  });

  try {
    core.runWithApplicationRuntime(runtime, () => {
      core.runWithRenderEnvironment({ refs: 'disabled' }, () => {
        expect(core.getActiveEnvironment().visible).toBe(visible);
        expect(core.getActiveEnvironment().effectBoundary).toBe(effectBoundary);
        core.runWithRenderEnvironment({ visible: undefined, effectBoundary: undefined }, () => {
          expect(core.getActiveEnvironment().visible).toBeUndefined();
          expect(core.getActiveEnvironment().effectBoundary).toBeUndefined();
        });
        expect(core.getActiveEnvironment().visible).toBe(visible);
      });
      expect(core.getActiveEnvironment().refs).toBe('run');
    });
  } finally {
    runtime.dispose();
  }
});
