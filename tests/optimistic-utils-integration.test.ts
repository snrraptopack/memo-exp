import { waitFor, stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, expect, it, vi } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { clearDataRuntime } from '@memoized-dom/data';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const outputDir = join(import.meta.dirname, 'fixtures', 'out', 'optimistic-utils-integration');
const fixture = join(outputDir, 'app.ts');

beforeAll(() => {
  const source = `
    import { $fetch, $forms } from '@memoized-dom/data';
    import { optimistic } from '@memoized-dom/utils';

    let votes = 0;
    let voteError = '';
    let lastSaved = 'none';
    let entries = [];
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return value.direction === 'up' || value.direction === 'down'
            ? { value: { direction: value.direction } }
            : { issues: [{ path: ['direction'], message: 'Choose a direction' }] };
        },
      },
    };
    const submitVote = optimistic({
      action: input => $fetch('/vote?direction=' + input.direction, { method: 'POST' }),
      apply(input, id) {
        const change = input.direction === 'up' ? 1 : -1;
        entries.push({ id, direction: input.direction, pending: true });
        votes += change;
        return error => {
          votes -= change;
          const index = entries.findIndex(entry => entry.id === id);
          if (index !== -1) entries.splice(index, 1);
          voteError = id + ':' + error.message;
        };
      },
      reconcile(saved, input, id) {
        const index = entries.findIndex(entry => entry.id === id);
        if (index !== -1) entries.splice(index, 1, {
          id: saved.id, direction: input.direction, pending: false,
        });
        lastSaved = saved.id;
      },
    });

    export function VoteApp() {
      const form = $forms({ schema, action: submitVote });
      return <section>
        <output id="votes">{votes}</output>
        <output id="saved">{lastSaved}</output>
        <ul id="entries">{entries.map(entry =>
          <li key={entry.id}>{entry.id}:{entry.direction}:{entry.pending ? 'pending' : 'saved'}</li>
        )}</ul>
        <button id="direct" onClick={() => { voteError = ''; submitVote({ direction: 'up' }); }}>Upvote</button>
        {voteError && <p id="direct-error">{voteError}</p>}
        <form onSubmit={form.submit}>
          <button id="form-up" type="submit" name="direction" value="up">Upvote in form</button>
          <button id="form-down" type="submit" name="direction" value="down">Downvote in form</button>
          {form.pending && <span id="pending">Saving</span>}
          {form.errors[0] && <p id="form-error">{form.errors[0].message}</p>}
        </form>
      </section>;
    }
  `;
  const output = compileModules({ './app.tsx': source });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(fixture, output['./app.tsx']!);
});

afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  document.body.replaceChildren();
  resetAccessTable();
  resetScheduler();
  clearDataRuntime();
  unstubAllGlobals();
});

it('renders direct and form optimistic writes, then rolls back only failed out-of-order operations', async () => {
  const requests: Array<{ direction: string; resolve: (response: Response) => void }> = [];
  stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const direction = new URL(String(input), 'http://localhost').searchParams.get('direction')!;
    return new Promise<Response>(resolve => requests.push({ direction, resolve }));
  }));
  const { VoteApp } = await import(pathToFileURL(fixture).href);
  setScheduler(run => run());
  const root = VoteApp('App', null) as HTMLElement;
  document.body.append(root);
  expect(root.querySelector('#votes')?.textContent).toBe('0');

  root.querySelector<HTMLButtonElement>('#direct')!.click();
  root.querySelector<HTMLButtonElement>('#direct')!.click();
  await waitFor(() => expect(root.querySelector('#votes')?.textContent).toBe('2'));
  await waitFor(() => expect(requests).toHaveLength(2));

  const form = root.querySelector('form')!;
  const submit = (button: HTMLButtonElement) => {
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  submit(root.querySelector<HTMLButtonElement>('#form-up')!);
  submit(root.querySelector<HTMLButtonElement>('#form-down')!);
  await waitFor(() => expect(root.querySelector('#votes')?.textContent).toBe('2'));
  await waitFor(() => expect(requests).toHaveLength(4));
  expect(root.querySelector('#pending')).not.toBeNull();
  expect(root.querySelectorAll('#entries li')).toHaveLength(4);
  expect(root.querySelector('#entries')?.textContent).toContain('pending');

  requests[2]!.resolve(Response.json({ id: 'form-up' }));
  await waitFor(() => expect(root.querySelector('#saved')?.textContent).toBe('form-up'));
  expect(root.querySelector('#entries')?.textContent).toContain('form-up:up:saved');
  await waitFor(() => expect(root.querySelector('#pending')).not.toBeNull());
  requests[0]!.resolve(Response.json({ error: 'first failed' }, { status: 409 }));
  await waitFor(() => expect(root.querySelector('#votes')?.textContent).toBe('1'));
  expect(root.querySelector('#direct-error')?.textContent).toContain('status 409');

  requests[3]!.resolve(Response.json({ error: 'form failed' }, { status: 409 }));
  await waitFor(() => expect(root.querySelector('#votes')?.textContent).toBe('2'));
  await waitFor(() => expect(root.querySelector('#form-error')?.textContent).toContain('status 409'));
  requests[1]!.resolve(Response.json({ id: 'direct-up' }));
  await waitFor(() => expect(root.querySelector('#pending')).toBeNull());
  await waitFor(() => expect(root.querySelector('#saved')?.textContent).toBe('direct-up'));
  expect(root.querySelector('#votes')?.textContent).toBe('2');
  expect([...root.querySelectorAll('#entries li')].map(row => row.textContent)).toEqual([
    'direct-up:up:saved',
    'form-up:up:saved',
  ]);
  expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
});
