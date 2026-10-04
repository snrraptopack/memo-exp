import { afterEach, beforeEach, expect, it } from 'vitest';
import { mountInitial, registerRootFactory, type MountedApplication } from '../packages/runtime/src/mount-core';
import { mount } from '../packages/runtime/src/mount';
import { cleanup } from '../packages/runtime/src/cleanup';
import {
  createApplicationRuntime, getActiveApplicationRuntime, registerEntity,
  runWithApplicationRuntime, setActiveApplicationRuntime, type ApplicationRuntime,
} from '../packages/runtime/src/kernel';

const runtimes: ApplicationRuntime[] = [];
const applications: MountedApplication[] = [];
let previous: ApplicationRuntime;
beforeEach(() => { previous = getActiveApplicationRuntime(); });
afterEach(() => {
  for (const app of applications.splice(0)) app.unmount();
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  setActiveApplicationRuntime(previous);
  document.body.replaceChildren();
});

function isolated(id: string) {
  const runtime = createApplicationRuntime(id, { document, schedule: null });
  runtimes.push(runtime);
  return runtime;
}

it.each([['initial HTML', mountInitial], ['general', mount]] as const)(
  'unmounts its original runtime after another becomes active (%s)', (_name, attach) => {
  const a = isolated('a'), b = isolated('b');
  const host = document.createElement('div');
  document.body.append(host);
  const cleanups: string[] = [];
  const App = () => undefined;
  registerRootFactory(App, { id: 'App', create() {
    registerEntity({ id: 'App', parent: null, render() {} });
    cleanup('App', () => cleanups.push(getActiveApplicationRuntime().id));
    return document.createElement('main');
  } });
  const app = runWithApplicationRuntime(a, () => attach(host, App));
  applications.push(app);
  runWithApplicationRuntime(b, () => {
    registerEntity({ id: 'App', parent: null, render() {} });
    cleanup('App', () => cleanups.push('wrong owner'));
  });
  setActiveApplicationRuntime(b);
  app.unmount();
  expect(cleanups).toEqual(['a']);
  expect(a.state.registry.has('App')).toBe(false);
  expect(b.state.registry.has('App')).toBe(true);
  expect(getActiveApplicationRuntime()).toBe(b);
  expect(host.childNodes).toHaveLength(0);
});

it('shares duplicate-host and duplicate-root validation with the general mount', () => {
  const runtime = isolated('duplicate');
  const host = document.createElement('div'), other = document.createElement('div');
  document.body.append(host, other);
  const App = () => undefined;
  registerRootFactory(App, { id: 'App', create() {
    registerEntity({ id: 'App', parent: null, render() {} });
    return document.createElement('main');
  } });
  runWithApplicationRuntime(runtime, () => {
    const app = mountInitial(host, App);
    applications.push(app);
    expect(() => mount(host, App)).toThrow(/already owns/);
    expect(() => mount(other, App)).toThrow(/already mounted/);
    app.unmount();
    applications.push(mount(other, App));
  });
});

it('cleans a failed factory and allows a later mount', () => {
  const runtime = isolated('failure');
  const host = document.createElement('div');
  document.body.append(host);
  let fail = true, cleaned = 0;
  const App = () => undefined;
  registerRootFactory(App, { id: 'App', create() {
    registerEntity({ id: 'App', parent: null, render() {} });
    cleanup('App', () => cleaned++);
    if (fail) throw new Error('factory failed');
    return document.createElement('main');
  } });
  runWithApplicationRuntime(runtime, () => {
    expect(() => mountInitial(host, App)).toThrow('factory failed');
    expect(runtime.state.registry.has('App')).toBe(false);
    expect(cleaned).toBe(1);
    expect(host.childNodes).toHaveLength(0);
    fail = false;
    applications.push(mountInitial(host, App));
  });
});

it('restores the caller after cleanup fails, removes nodes and stays unmounted', () => {
  const a = isolated('cleanup-a'), b = isolated('cleanup-b');
  const host = document.createElement('div');
  document.body.append(host);
  const failure = new Error('cleanup failed');
  const App = () => undefined;
  registerRootFactory(App, { id: 'App', create() {
    registerEntity({ id: 'App', parent: null, render() {} });
    cleanup('App', () => {
      expect(getActiveApplicationRuntime()).toBe(a);
      throw failure;
    });
    return document.createElement('main');
  } });
  const app = runWithApplicationRuntime(a, () => mountInitial(host, App));
  applications.push(app);
  setActiveApplicationRuntime(b);
  expect(() => app.unmount()).toThrow(failure);
  expect(getActiveApplicationRuntime()).toBe(b);
  expect(app.mounted).toBe(false);
  expect(host.childNodes).toHaveLength(0);
  expect(a.state.registry.has('App')).toBe(false);
  expect(() => app.unmount()).not.toThrow();
});
