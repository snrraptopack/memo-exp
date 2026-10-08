import { waitFor, type FetchStub } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { createDataRuntime, RequestError, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import { toPresentationError } from '@memoized-dom/runtime';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const source = `
  import { Group, $fetch } from '@memoized-dom/data';
  function Failure({ error, retry }) {
    return <button id="failure" onClick={retry}>{error.kind}:{error.status}:{error.cause.kind}:{error.message}</button>;
  }
  function RetryOnly({ retry }) { return <button id="retry-only" onClick={retry}>Retry</button>; }
  export function Progressive() {
    const data = $fetch('/group-error');
    return <Group error={Failure}><p>{data.name}</p></Group>;
  }
  export function Atomic() {
    const data = $fetch('/group-error');
    return <Group suspend error={Failure}><p>{data.name}</p></Group>;
  }
  export function NarrowCallback() {
    const data = $fetch('/group-error');
    return <Group error={RetryOnly}><p>{data.name}</p></Group>;
  }
`;
describe('unified Group failure presentation', () => {
  let fixture: Record<string, (id: string, parent: null) => Node>;
  let data: DataRuntime | undefined;
  let previous: DataRuntime | undefined;
  beforeAll(async () => {
    const output = compileModules({ './App.tsx': source });
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'group-error-presentation');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'App.ts');
    writeFileSync(file, output['./App.tsx']!);
    fixture = await import(pathToFileURL(file).href);
  });
  afterEach(() => {
    for (const id of _internals().registry.keys()) unregister(id);
    if (previous !== undefined) setActiveDataRuntime(previous);
    data?.clear();
    previous = undefined;
    data = undefined;
    resetScheduler();
    document.body.replaceChildren();
  });
  function mount(name: string) {
    let attempts = 0;
    data = createDataRuntime({ fetch: (async () => {
      const failed = ++attempts === 1;
      return new Response(JSON.stringify(failed ? { message: 'Unavailable' } : { name: 'Recovered' }), {
        status: failed ? 503 : 200, headers: { 'content-type': 'application/json' },
      });
    }) as FetchStub });
    previous = setActiveDataRuntime(data);
    setScheduler(run => run());
    document.body.append(fixture[name]!(name, null));
  }
  it.each(['Progressive', 'Atomic'])('normalizes %s errors without losing request detail or retry', async name => {
    mount(name);
    await waitFor(() => expect(document.querySelector('#failure')?.textContent).toContain('request:503:http:'));
    document.querySelector<HTMLButtonElement>('#failure')!.click();
    await waitFor(() => expect(document.body.textContent).toContain('Recovered'));
    expect(document.querySelector('#failure')).toBeNull();
  });
  it('permits error callbacks that consume only retry', async () => {
    mount('NarrowCallback');
    await waitFor(() => expect(document.querySelector('#retry-only')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('#retry-only')!.click();
    await waitFor(() => expect(document.body.textContent).toContain('Recovered'));
  });
  it('preserves original transport errors and stable presentation identity', () => {
    const request = new RequestError('Bad request', { kind: 'validation', status: 422, data: { field: 'email' } });
    const presentation = toPresentationError(request);
    expect(request.kind).toBe('validation');
    expect(presentation).toMatchObject({ kind: 'request', requestKind: 'validation', status: 422, data: { field: 'email' }, cause: request });
    expect(toPresentationError(request)).toBe(presentation);
    expect(toPresentationError(presentation)).toBe(presentation);
  });
  it('distinguishes module failures and crashes while preserving their cause', () => {
    const cause = new Error('Cannot import chunk');
    expect(toPresentationError(cause, 'module')).toMatchObject({ kind: 'module', message: cause.message, cause });
    expect(toPresentationError(cause)).toMatchObject({ kind: 'crash', cause });
    expect(toPresentationError('Thrown string')).toMatchObject({ kind: 'crash', message: 'Thrown string', cause: 'Thrown string' });
  });
});
