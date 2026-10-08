import { waitFor, type FetchStub } from '../test-support/helpers';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import {
  createDataRuntime,
  setActiveDataRuntime,
  type DataRuntime,
} from '@memoized-dom/data';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const fixtureDir = join(import.meta.dirname, 'fixtures');
const sourcePath = join(fixtureDir, 'group-boundary-behavior.tsx');
const invalidSourcePath = join(
  fixtureDir,
  'group-boundary-invalid-descendant.tsx',
);
const outDir = join(fixtureDir, 'out', 'group-boundary-behavior');
const compiledPath = join(outDir, 'group-boundary-behavior.ts');

interface FixtureModule {
  SharedSourceChildSuspended(id: string, parent: null): Node;
  IndependentChildSuspended(id: string, parent: null): Node;
  ParentSuspendsComponent(id: string, parent: null): Node;
  ChildSuspendsOwnElement(id: string, parent: null): Node;
  SuspendedParentCreatesWaterfall(id: string, parent: null): Node;
  SuspendedRefreshAndRebind(id: string, parent: null): Node;
  MultipleFailureSuspended(id: string, parent: null): Node;
  SuspendedParentWithColorlessChild(id: string, parent: null): Node;
}

interface DeferredRequest {
  url: string;
  resolve(response: Response): void;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status = 503): Response {
  return new Response(JSON.stringify({ message: 'offline' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Group boundaries across component ownership', () => {
  let fixture: FixtureModule;
  let runtime: DataRuntime | null = null;
  let previousRuntime: DataRuntime | null = null;
  let requests: DeferredRequest[] = [];

  beforeAll(async () => {
    const source = readFileSync(sourcePath, 'utf8');
    const output = compileModules({
      './group-boundary-behavior.tsx': source,
    });
    const compiled = output['./group-boundary-behavior.tsx']!;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(compiledPath, compiled);
    fixture = await import(pathToFileURL(compiledPath).href) as FixtureModule;
  });

  afterEach(() => {
    for (const id of _internals().registry.keys()) unregister(id);
    document.body.replaceChildren();
    resetAccessTable();
    resetScheduler();
    if (previousRuntime !== null) setActiveDataRuntime(previousRuntime);
    runtime?.clear();
    runtime = null;
    previousRuntime = null;
    requests = [];
  });

  function mount(name: keyof FixtureModule): void {
    runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) =>
        new Promise<Response>((resolve) => {
          requests.push({ url: String(input), resolve });
        })) as FetchStub,
    });
    previousRuntime = setActiveDataRuntime(runtime);
    setScheduler(run => run());
    document.body.appendChild(fixture[name](name, null));
  }

  function request(suffix: string): DeferredRequest {
    const found = requests.find(candidate => candidate.url.endsWith(suffix));
    if (found === undefined) throw new Error(`missing request ending in ${suffix}`);
    return found;
  }

  it('keeps normal A mounted while suspended B consumes the same A-owned source', async () => {
    mount('SharedSourceChildSuspended');
    await waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('#shared-a-shell')).not.toBeNull();
    expect(document.querySelector('#shared-a-value .outer-pending')).not.toBeNull();
    expect(document.querySelector('.inner-pending')).not.toBeNull();
    expect(document.querySelector('#shared-b')).toBeNull();

    request('/matrix/shared-user').resolve(json({ name: 'Ada' }));
    await waitFor(async () => expect(await (() => document.querySelector('#shared-a-value')?.textContent)())
      .toBe('Ada'));
    expect(document.querySelector('#shared-b')?.textContent).toBe('Ada');
  });

  it('renders separate nearest error policies when normal A and suspended B share a failed source', async () => {
    mount('SharedSourceChildSuspended');
    await waitFor(() => expect(requests).toHaveLength(1));

    request('/matrix/shared-user').resolve(failure());
    await waitFor(async () => expect(await (() => document.querySelector('#shared-a-value .outer-error')?.textContent)()).toContain('503'));
    expect(document.querySelector('.inner-error')?.textContent).toContain('503');
    expect(document.querySelector('#shared-b')).toBeNull();
    expect(document.querySelector('#shared-a-shell')).not.toBeNull();
  });

  it('lets suspended B mount before an independent A-owned source resolves', async () => {
    mount('IndependentChildSuspended');
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(document.querySelector('#independent-a-shell')).not.toBeNull();
    expect(document.querySelector('#independent-a-value .outer-pending')).not.toBeNull();
    expect(document.querySelector('#independent-b')).toBeNull();

    request('/matrix/independent-details').resolve(json({ name: 'Details' }));
    await waitFor(async () => expect(await (() => document.querySelector('#independent-b')?.textContent)())
      .toBe('Details'));
    expect(document.querySelector('#independent-a-value .outer-pending')).not.toBeNull();

    request('/matrix/independent-summary').resolve(json({ text: 'Summary' }));
    await waitFor(async () => expect(await (() => document.querySelector('#independent-a-value')?.textContent)()).toBe('Summary'));
  });

  it('withholds normal B when the component A containing it is suspended', async () => {
    mount('ParentSuspendsComponent');
    await waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('.outer-pending')).not.toBeNull();
    expect(document.querySelector('#parent-suspended-a')).toBeNull();
    expect(document.querySelector('#parent-suspended-b')).toBeNull();

    request('/matrix/parent-suspended-user').resolve(json({ name: 'Ada' }));
    await waitFor(async () => expect(await (() => document.querySelector('#parent-suspended-b')?.textContent)()).toBe('Ada'));
    expect(document.querySelector('#parent-suspended-a')).not.toBeNull();
  });

  it('allows B to mount normally while an element inside B suspends A-owned data', async () => {
    mount('ChildSuspendsOwnElement');
    await waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('#self-suspending-a-shell')).not.toBeNull();
    expect(document.querySelector('#self-suspending-b-shell')).not.toBeNull();
    expect(document.querySelector('.inner-pending')).not.toBeNull();
    expect(document.querySelector('#self-suspending-b-value')).toBeNull();

    request('/matrix/self-suspending-user').resolve(json({ name: 'Ada' }));
    await waitFor(async () => expect(await (() => document.querySelector('#self-suspending-b-value')?.textContent)()).toBe('Ada'));
  });

  it('discovers child-owned requests before publishing the suspended parent', async () => {
    mount('SuspendedParentCreatesWaterfall');
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]!.url).toMatch(/\/matrix\/waterfall-parent$/);
    expect(document.querySelector('#waterfall-a-shell')).toBeNull();
    expect(document.querySelector('#waterfall-b-shell')).toBeNull();

    request('/matrix/waterfall-parent').resolve(json({ name: 'Parent' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/matrix\/waterfall-child$/);
    expect(document.querySelector('#waterfall-a-shell')).toBeNull();
    expect(document.querySelector('#waterfall-b-shell')).toBeNull();
    expect(document.querySelector('#waterfall-b-value')).toBeNull();
    expect(document.querySelector('.inner-pending')).toBeNull();
    expect(document.querySelector('.outer-pending')).not.toBeNull();

    request('/matrix/waterfall-child').resolve(json({ name: 'Child' }));
    await waitFor(async () => expect(await (() => document.querySelector('#waterfall-b-value')?.textContent)()).toBe('Child'));
  });

  it('withholds the entire staged subtree when the parent dependency fails', async () => {
    mount('SuspendedParentCreatesWaterfall');
    await waitFor(() => expect(requests).toHaveLength(2));

    request('/matrix/waterfall-parent').resolve(failure());
    await waitFor(async () => expect(await (() => document.querySelector('.outer-error')?.textContent)())
      .toContain('503'));
    expect(requests).toHaveLength(2);
    expect(document.querySelector('#waterfall-a-shell')).toBeNull();
    expect(document.querySelector('#waterfall-b-shell')).toBeNull();
  });

  it('keeps the committed owner during refresh and uses read-local pending on rebind', async () => {
    mount('SuspendedRefreshAndRebind');
    await waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('#rebind-shell')).not.toBeNull();
    expect(document.querySelector('#rebind-value')).toBeNull();
    request('/matrix/rebind/one').resolve(json({ name: 'Initial' }));
    await waitFor(async () => expect(await (() => document.querySelector('#rebind-value')?.textContent)())
      .toBe('Initial'));
    const committed = document.querySelector('#rebind-value');

    document.querySelector<HTMLButtonElement>('#refresh-source')!.click();
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/matrix\/rebind\/one$/);
    expect(document.querySelector('#rebind-value')?.textContent).toBe('Initial');
    expect(document.querySelector('.outer-pending')).toBeNull();
    requests[1]!.resolve(json({ name: 'Refreshed' }));
    await waitFor(async () => expect(await (() => document.querySelector('#rebind-value')?.textContent)())
      .toBe('Refreshed'));

    document.querySelector<HTMLButtonElement>('#rebind-source')!.click();
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.url).toMatch(/\/matrix\/rebind\/two$/);
    expect(document.querySelector('#rebind-value')).toBe(committed);
    expect(document.querySelector('.outer-pending')).not.toBeNull();
    requests[2]!.resolve(json({ name: 'Rebound' }));
    await waitFor(async () => expect(await (() => document.querySelector('#rebind-value')?.textContent)())
      .toBe('Rebound'));
  });

  it('retries every failed dependency represented by one suspended boundary', async () => {
    mount('MultipleFailureSuspended');
    await waitFor(() => expect(requests).toHaveLength(2));

    request('/matrix/failure-left').resolve(failure(501));
    request('/matrix/failure-right').resolve(failure(502));
    await waitFor(async () => expect(await (() => document.querySelector('.multi-error')?.textContent)())
      .toContain('501'));

    document.querySelector<HTMLButtonElement>('.multi-error')!.click();
    await waitFor(() => expect(requests).toHaveLength(4));
    expect(requests[2]!.url).toMatch(/\/matrix\/failure-left$/);
    expect(requests[3]!.url).toMatch(/\/matrix\/failure-right$/);
    expect(document.querySelector('.multi-error')).toBeNull();
    expect(document.querySelector('.outer-pending')).not.toBeNull();

    requests[2]!.resolve(json({ name: 'Left' }));
    await Promise.resolve();
    expect(document.querySelector('.outer-pending')).not.toBeNull();
    expect(document.querySelector('#multi-value')).toBeNull();
    requests[3]!.resolve(json({ name: 'Right' }));
    await waitFor(async () => expect(await (() => document.querySelector('#multi-value')?.textContent)())
      .toBe('Left:Right'));
  });

  it('includes child-private sources in the parent atomic activation', async () => {
    mount('SuspendedParentWithColorlessChild');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]!.url).toMatch(/\/matrix\/mixed-parent$/);
    expect(document.querySelector('#mixed-parent')).toBeNull();

    requests[0]!.resolve(json({ name: 'Parent' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/matrix\/mixed-child$/);
    expect(document.querySelector('#mixed-parent')).toBeNull();
    expect(document.querySelector('#mixed-child')).toBeNull();
    expect(document.querySelector('.outer-pending')).not.toBeNull();

    requests[1]!.resolve(json({ name: 'Child' }));
    await waitFor(async () => expect(await (() => document.querySelector('#mixed-child')?.textContent)())
      .toBe('Child'));
    expect(document.querySelector('.outer-pending')).toBeNull();
  });

  it('accepts parent suspension when the only source is owned inside B', () => {
    const source = readFileSync(invalidSourcePath, 'utf8');
    const output = compileModules({
      './group-boundary-invalid-descendant.tsx': source,
    });
    expect(output['./group-boundary-invalid-descendant.tsx']).toContain('createPreparedRegion');
  });
});
