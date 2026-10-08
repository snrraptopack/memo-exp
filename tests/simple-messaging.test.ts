import { waitFor, stubGlobal, unstubAllGlobals } from '../test-support/helpers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'bun:test';
import { compileModules } from '@memoized-dom/compiler';
import { clearDataRuntime } from '@memoized-dom/data';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const messagingSource = `
  import { $forms } from '@memoized-dom/data';
  import { optimistic } from '@memoized-dom/utils';
  import { deliverMessage } from './action';

  function Thread({ messages }) {
    const send = optimistic({
      action: fields => deliverMessage(String(fields.get('message') ?? '')),
      apply(fields, id) {
        messages.push({ key: id, text: String(fields.get('message') ?? ''), sending: true });
        return () => {
          const index = messages.findIndex(message => message.key === id);
          if (index !== -1) messages.splice(index, 1);
        };
      },
      reconcile(saved, _fields, id) {
        const index = messages.findIndex(message => message.key === id);
        if (index !== -1) messages[index] = { key: id, text: saved, sending: false };
      },
    });
    const form = $forms(send);
    return <>
      {messages.map(message => <div key={message.key}>
        {message.text}{message.sending && <small> (Sending...)</small>}
      </div>)}
      <form onSubmit={event => { form.submit(event); event.currentTarget.reset(); }}>
        <input name="message" /><button type="submit">Send</button>
        {form.errors && form.errors.map(error => {
          console.log(form.errors);
          return <p>{error.kind === 'parse' ? 'parse error' : error.message}</p>;
        })}
      </form>
    </>;
  }
  export function App() {
    const messages = [{ key: 'welcome', text: 'Hello there!', sending: false }];
    return <Thread messages={messages} />;
  }
`;
const directory = join(import.meta.dirname, 'fixtures/out/simple-messaging');

afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  document.body.replaceChildren();
  resetAccessTable();
  resetScheduler();
  clearDataRuntime();
  unstubAllGlobals();
  vi.restoreAllMocks();
});

it('compiles an optimistic form with an expression before the error-row return', () => {
  expect(() => compileModules({ './App.tsx': messagingSource, './action.ts': 'export async function deliverMessage(message) { return message; }' })).not.toThrow();
});

it('submits overlapping optimistic messages, reconciles success and rolls back failure', async () => {
  const requests: Array<{ message: string; resolve(value: string): void; reject(error: Error): void }> = [];
  stubGlobal('__messageRequests', requests);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const modules = compileModules({
    './App.tsx': messagingSource,
    './action.ts': `export function deliverMessage(message) {
      return new Promise((resolve, reject) => globalThis.__messageRequests.push({ message, resolve, reject }));
    }`,
  });
  mkdirSync(directory, { recursive: true });
  for (const [file, output] of Object.entries(modules)) writeFileSync(join(directory, file.slice(2)), output);
  const specifier = './fixtures/out/simple-messaging/App.tsx';
  const { App } = await import(specifier);
  setScheduler(run => run());
  const root = App('App', null);
  document.body.append(root);
  const form = document.querySelector('form')!;
  const input = form.querySelector('input')!;
  const submit = (message: string) => {
    input.value = message;
    const event = new SubmitEvent('submit', { cancelable: true, submitter: form.querySelector('button') });
    Object.defineProperty(event, 'currentTarget', { value: form });
    expect(() => form.onsubmit!.call(form, event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
  };

  submit('first');
  submit('second');
  await waitFor(() => expect(requests).toHaveLength(2));
  await waitFor(() => expect(document.querySelectorAll('small')).toHaveLength(2));
  requests[1]!.resolve('saved second');
  await waitFor(() => expect(document.body.textContent).toContain('saved second'));
  expect(document.querySelectorAll('small')).toHaveLength(1);
  requests[0]!.reject(new Error('Delivery failed'));
  await waitFor(() => expect(document.querySelectorAll('small')).toHaveLength(0));
  expect(document.body.textContent).not.toContain('first');
  expect(document.body.textContent).toContain('Hello there!');
  expect(document.body.textContent).toContain('saved second');
  // The form reports its newest attempt. An older failed operation still
  // rolls back its own row without overwriting a newer successful result.
  submit('third');
  await waitFor(() => expect(requests).toHaveLength(3));
  requests[2]!.reject(new Error('Newest delivery failed'));
  await waitFor(() => expect(form.querySelector('p')?.textContent).toContain('Newest delivery failed'));
  expect(log).toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('third');
  submit('fourth');
  await waitFor(() => expect(requests).toHaveLength(4));
  requests[3]!.resolve('saved fourth');
  await waitFor(() => expect(document.body.textContent).toContain('saved fourth'));
  expect(form.querySelector('p')).toBeNull();
  expect(document.querySelectorAll('small')).toHaveLength(0);
});
