import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
        })) as typeof fetch,
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
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('#shared-a-shell')).not.toBeNull();
    expect(document.querySelector('#shared-a-value .outer-pending')).not.toBeNull();
    expect(document.querySelector('.inner-pending')).not.toBeNull();
    expect(document.querySelector('#shared-b')).toBeNull();

    request('/matrix/shared-user').resolve(json({ name: 'Ada' }));
    await expect.poll(() => document.querySelector('#shared-a-value')?.textContent)
      .toBe('Ada');
    expect(document.querySelector('#shared-b')?.textContent).toBe('Ada');
  });

  it('renders separate nearest error policies when normal A and suspended B share a failed source', async () => {
    mount('SharedSourceChildSuspended');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    request('/matrix/shared-user').resolve(failure());
    await expect.poll(
      () => document.querySelector('#shared-a-value .outer-error')?.textContent,
    ).toContain('503');
    expect(document.querySelector('.inner-error')?.textContent).toContain('503');
    expect(document.querySelector('#shared-b')).toBeNull();
    expect(document.querySelector('#shared-a-shell')).not.toBeNull();
  });

  it('lets suspended B mount before an independent A-owned source resolves', async () => {
    mount('IndependentChildSuspended');
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(document.querySelector('#independent-a-shell')).not.toBeNull();
    expect(document.querySelector('#independent-a-value .outer-pending')).not.toBeNull();
    expect(document.querySelector('#independent-b')).toBeNull();

    request('/matrix/independent-details').resolve(json({ name: 'Details' }));
    await expect.poll(() => document.querySelector('#independent-b')?.textContent)
      .toBe('Details');
    expect(document.querySelector('#independent-a-value .outer-pending')).not.toBeNull();

    request('/matrix/independent-summary').resolve(json({ text: 'Summary' }));
    await expect.poll(
      () => document.querySelector('#independent-a-value')?.textContent,
    ).toBe('Summary');
  });

  it('withholds normal B when the component A containing it is suspended', async () => {
    mount('ParentSuspendsComponent');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('.outer-pending')).not.toBeNull();
    expect(document.querySelector('#parent-suspended-a')).toBeNull();
    expect(document.querySelector('#parent-suspended-b')).toBeNull();

    request('/matrix/parent-suspended-user').resolve(json({ name: 'Ada' }));
    await expect.poll(
      () => document.querySelector('#parent-suspended-b')?.textContent,
    ).toBe('Ada');
    expect(document.querySelector('#parent-suspended-a')).not.toBeNull();
  });

  it('allows B to mount normally while an element inside B suspends A-owned data', async () => {
    mount('ChildSuspendsOwnElement');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('#self-suspending-a-shell')).not.toBeNull();
    expect(document.querySelector('#self-suspending-b-shell')).not.toBeNull();
    expect(document.querySelector('.inner-pending')).not.toBeNull();
    expect(document.querySelector('#self-suspending-b-value')).toBeNull();

    request('/matrix/self-suspending-user').resolve(json({ name: 'Ada' }));
    await expect.poll(
      () => document.querySelector('#self-suspending-b-value')?.textContent,
    ).toBe('Ada');
  });

  it('starts a child-owned request only after its suspended parent mounts', async () => {
    mount('SuspendedParentCreatesWaterfall');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0]!.url).toMatch(/\/matrix\/waterfall-parent$/);
    expect(document.querySelector('#waterfall-a-shell')).toBeNull();
    expect(document.querySelector('#waterfall-b-shell')).toBeNull();

    request('/matrix/waterfall-parent').resolve(json({ name: 'Parent' }));
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/matrix\/waterfall-child$/);
    expect(document.querySelector('#waterfall-a-shell')).not.toBeNull();
    expect(document.querySelector('#waterfall-b-shell')).not.toBeNull();
    expect(document.querySelector('#waterfall-b-value')).toBeNull();
    expect(document.querySelector('.inner-pending')).not.toBeNull();

    request('/matrix/waterfall-child').resolve(json({ name: 'Child' }));
    await expect.poll(
      () => document.querySelector('#waterfall-b-value')?.textContent,
    ).toBe('Child');
  });

  it('does not start a child-owned request when the suspended parent fails', async () => {
    mount('SuspendedParentCreatesWaterfall');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    request('/matrix/waterfall-parent').resolve(failure());
    await expect.poll(() => document.querySelector('.outer-error')?.textContent)
      .toContain('503');
    expect(requests).toHaveLength(1);
    expect(document.querySelector('#waterfall-a-shell')).toBeNull();
    expect(document.querySelector('#waterfall-b-shell')).toBeNull();
  });

  it('keeps committed suspended content during refresh but suspends it on rebind', async () => {
    mount('SuspendedRefreshAndRebind');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(document.querySelector('#rebind-shell')).not.toBeNull();
    expect(document.querySelector('#rebind-value')).toBeNull();
    request('/matrix/rebind/one').resolve(json({ name: 'Initial' }));
    await expect.poll(() => document.querySelector('#rebind-value')?.textContent)
      .toBe('Initial');

    document.querySelector<HTMLButtonElement>('#refresh-source')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/matrix\/rebind\/one$/);
    expect(document.querySelector('#rebind-value')?.textContent).toBe('Initial');
    expect(document.querySelector('.outer-pending')).toBeNull();
    requests[1]!.resolve(json({ name: 'Refreshed' }));
    await expect.poll(() => document.querySelector('#rebind-value')?.textContent)
      .toBe('Refreshed');

    document.querySelector<HTMLButtonElement>('#rebind-source')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]!.url).toMatch(/\/matrix\/rebind\/two$/);
    expect(document.querySelector('#rebind-value')).toBeNull();
    expect(document.querySelector('.outer-pending')).not.toBeNull();
    requests[2]!.resolve(json({ name: 'Rebound' }));
    await expect.poll(() => document.querySelector('#rebind-value')?.textContent)
      .toBe('Rebound');
  });

  it('retries every failed dependency represented by one suspended boundary', async () => {
    mount('MultipleFailureSuspended');
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    request('/matrix/failure-left').resolve(failure(501));
    request('/matrix/failure-right').resolve(failure(502));
    await expect.poll(() => document.querySelector('.multi-error')?.textContent)
      .toContain('501');

    document.querySelector<HTMLButtonElement>('.multi-error')!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(4));
    expect(requests[2]!.url).toMatch(/\/matrix\/failure-left$/);
    expect(requests[3]!.url).toMatch(/\/matrix\/failure-right$/);
    expect(document.querySelector('.multi-error')).toBeNull();
    expect(document.querySelector('.outer-pending')).not.toBeNull();

    requests[2]!.resolve(json({ name: 'Left' }));
    await Promise.resolve();
    expect(document.querySelector('.outer-pending')).not.toBeNull();
    expect(document.querySelector('#multi-value')).toBeNull();
    requests[3]!.resolve(json({ name: 'Right' }));
    await expect.poll(() => document.querySelector('#multi-value')?.textContent)
      .toBe('Left:Right');
  });

  it('opens a parent gate before starting an ungrouped child-private source', async () => {
    mount('SuspendedParentWithColorlessChild');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.url).toMatch(/\/matrix\/mixed-parent$/);
    expect(document.querySelector('#mixed-parent')).toBeNull();

    requests[0]!.resolve(json({ name: 'Parent' }));
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toMatch(/\/matrix\/mixed-child$/);
    expect(document.querySelector('#mixed-parent output')?.textContent)
      .toBe('Parent');
    expect(document.querySelector('#mixed-child')?.textContent).toBe('');
    expect(document.querySelector('.outer-pending')).toBeNull();

    requests[1]!.resolve(json({ name: 'Child' }));
    await expect.poll(() => document.querySelector('#mixed-child')?.textContent)
      .toBe('Child');
  });

  it('rejects parent suspension when the only source is owned inside B', () => {
    const source = readFileSync(invalidSourcePath, 'utf8');
    expect(() => compileModules({
      './group-boundary-invalid-descendant.tsx': source,
    })).toThrow(
      /suspended Group content must read colorless sources in the current component/,
    );
  });
});
