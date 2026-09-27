import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup, createApplicationRuntime, createPreparedRegion, getActiveEnvironment,
  mount, mountRef, refAssign, register, registerEffect, registerRootFactory,
  rootNodes, runWithApplicationRuntime, setScheduler,
  type ApplicationRuntime, type CondEntry, type MountedApplication,
} from '@memoized-dom/runtime/testing';
import '@memoized-dom/runtime/hydrate';

describe('atomic prepared-range hydration', () => {
  let runtime: ApplicationRuntime;
  let mounted: MountedApplication | undefined;
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  beforeEach(() => {
    runtime = createApplicationRuntime('prepared-hydration', { document, schedule: null });
    inRuntime(() => setScheduler(run => run()));
  });
  afterEach(() => {
    inRuntime(() => mounted?.unmount());
    mounted = undefined;
    runtime.dispose();
    document.body.replaceChildren();
  });

  function host(content: string) {
    const root = document.createElement('div');
    root.innerHTML = '<!--mmd:r:App-->' + content + '<!--/mmd-->';
    document.body.append(root);
    return root;
  }

  function app(nested = false) {
    const pending = vi.fn(() => ({ nodes: [document.createTextNode('Loading')], update() {} }));
    const refs = vi.fn();
    const effects = vi.fn();
    function App() {
      const dom = getActiveEnvironment().document;
      const fragment = dom.createDocumentFragment();
      register({ id: 'App', parent: null, render() { region.update(); } });
      const child = (): CondEntry => {
        register({ id: 'App/child', parent: 'App', render() {} });
        const text = dom.createTextNode('Ready');
        const node = dom.createElement('p');
        node.appendChild(text);
        cleanup('App/child', mountRef(node, refAssign(refs)));
        registerEffect('App/child/effect', 'App/child', () => { effects(node); });
        return { nodes: [node], update() { text.textContent = 'Updated'; } };
      };
      const region = createPreparedRegion(fragment, 'App/atomic', () => {
        if (!nested) return child();
        const innerFragment = dom.createDocumentFragment();
        const inner = createPreparedRegion(innerFragment, 'App/atomic/inner', child, pending);
        return { nodes: rootNodes(innerFragment), update: () => inner.update(), dispose: () => inner.dispose() };
      }, pending);
      cleanup('App', () => region.dispose());
      return fragment;
    }
    registerRootFactory(App, { id: 'App', create: App });
    return { App, pending, refs, effects };
  }

  it.each([false, true])('adopts resolved content without fallback, movement or duplication (nested=%s)', nested => {
    const fixture = app(nested);
    const markup = nested
      ? '<!--mmd:g:App/atomic--><!--mmd:g:App/atomic/inner--><p>Ready</p><!--/mmd--><!--/mmd-->'
      : '<!--mmd:g:App/atomic--><p>Ready</p><!--/mmd-->';
    const root = host(markup);
    const original = root.querySelector('p')!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(original.parentNode!, { childList: true });
    mounted = inRuntime(() => mount(root, fixture.App));
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelector('p')).toBe(original);
    expect(mutations.some(record => [...record.removedNodes].includes(original))).toBe(false);
    expect(fixture.pending).not.toHaveBeenCalled();
    expect(fixture.refs).toHaveBeenCalledExactlyOnceWith(original);
    expect(fixture.effects).toHaveBeenCalledExactlyOnceWith(original);
    inRuntime(() => runtime.state.registry.get('App')!.render(null));
    expect(original.textContent).toBe('Updated');
    inRuntime(() => mounted!.unmount());
    expect(root.childNodes).toHaveLength(0);
    expect(runtime.state.registry.size).toBe(0);
  });

  it('keeps the rejected server range intact until mount reports recovery', () => {
    const fixture = app();
    const root = host('<!--mmd:g:App/atomic--><span>Ready</span><!--/mmd-->');
    const original = root.querySelector('span')!;
    const mismatch = vi.fn(() => {
      expect(original.isConnected).toBe(true);
      expect(root.querySelector('span')).toBe(original);
    });
    mounted = inRuntime(() => mount(root, fixture.App, { onHydrateError: mismatch }));
    expect(mismatch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('span')).toBeNull();
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(fixture.pending).not.toHaveBeenCalled();
    expect(fixture.effects).toHaveBeenCalledTimes(1);
  });
});
