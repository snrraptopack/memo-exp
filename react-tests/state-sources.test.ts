import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from '../packages/compiler/src/compile';
import {
  _internals, resetAccessTable, resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';
import { compileFixture, fixtureRoot } from './harness';

const reducerApp = join(fixtureRoot, 'reducer-app.tsx');
const reducer = compileFixture({ entries: [reducerApp], packages: ['reducer-kit'],
  outDir: 'out/reducer' });
const storeApp = join(fixtureRoot, 'store-app.tsx');
const store = compileFixture({ entries: [storeApp], packages: ['store-kit'],
  outDir: 'out/store' });
const storeModuleId = 'store-kit/store.ts';

beforeEach(() => {
  document.body.replaceChildren();
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
  setScheduler((run) => run());
});
afterEach(() => resetScheduler());

describe('instance state operations', () => {
  it('lowers useReducer into independent MMD state and dispatch writes', async () => {
    const { App } = await import(/* @vite-ignore */ pathToFileURL(reducer.emitted.get(reducerApp)!).href);
    document.body.appendChild(App('ReducerApp', null));
    const [first, second] = [...document.querySelectorAll('button')];
    expect([first?.textContent, second?.textContent]).toEqual(['4', '4']);
    first!.click();
    expect([first?.textContent, second?.textContent]).toEqual(['6', '4']);
    first!.click();
    expect([first?.textContent, second?.textContent]).toEqual(['8', '4']);
  });
});

describe('external state source', () => {
  it('keeps a package relative import in the opted-in package graph', () => {
    expect(store.graph.modules[storeModuleId]).toBeTruthy();
    expect(store.emitted.get(storeModuleId)).toBeTruthy();
    expect(store.output['store-kit/counter.tsx']).not.toMatch(/from ['"]react['"]/);
  });

  it('diagnoses source contracts without a defined MMD target', () => {
    const options = { moduleId: 'store-kit/invalid.tsx', react: { packages: ['store-kit'] } };
    expect(() => compile(`import { useSyncExternalStore } from 'react';
      function Counter() { const value = useSyncExternalStore(subscribe, read, serverRead);
        return <p>{value}</p>; }`, options)).toThrow('server snapshot');
    expect(() => compile(`import { useSyncExternalStore } from 'react';
      function Counter() { const Object = {}; const value = useSyncExternalStore(subscribe, read);
        return <p>{value}</p>; }`, options)).toThrow('shadowed');
  });

  it('subscribes after mount, updates both readers, and disposes subscriptions', async () => {
    const { App } = await import(/* @vite-ignore */ pathToFileURL(store.emitted.get(storeApp)!).href);
    const storeModule = await import(/* @vite-ignore */ pathToFileURL(store.emitted.get(storeModuleId)!).href);
    const before = storeModule.getSnapshot();
    document.body.appendChild(App('StoreApp', null));
    const [first, second] = [...document.querySelectorAll('button')];
    expect([first?.textContent, second?.textContent]).toEqual([String(before), String(before)]);
    expect(storeModule.subscriberCount()).toBe(2);
    const subscriptions = storeModule.subscriptionCount();
    first!.click();
    expect([first?.textContent, second?.textContent]).toEqual([String(before + 1), String(before + 1)]);
    expect(storeModule.subscriberCount()).toBe(2);
    expect(storeModule.subscriptionCount()).toBe(subscriptions);
    unregister('StoreApp');
    expect(storeModule.subscriberCount()).toBe(0);
  });

  it('closes a snapshot change between the first read and subscription', async () => {
    const { App } = await import(/* @vite-ignore */ pathToFileURL(store.emitted.get(storeApp)!).href);
    const storeModule = await import(/* @vite-ignore */ pathToFileURL(store.emitted.get(storeModuleId)!).href);
    const before = storeModule.getSnapshot();
    storeModule.scheduleMissedChange();
    document.body.appendChild(App('RaceApp', null));
    const [first, second] = [...document.querySelectorAll('button')];
    expect([first?.textContent, second?.textContent]).toEqual([String(before + 1), String(before + 1)]);
    unregister('RaceApp');
    expect(storeModule.subscriberCount()).toBe(0);
  });
});
