import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { renderToStringAsync } from '@memoized-dom/server';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const outputDir = join(import.meta.dirname, 'fixtures', 'out', 'data-forms-read-integration');
const fixture = join(outputDir, 'app.ts');

beforeAll(() => {
  const source = `
    import { $forms, $read, $track, Group } from '@memoized-dom/data';
    const schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return typeof value.message === 'string' && value.message.trim()
            ? { value: { message: value.message.trim() } }
            : { issues: [{ path: ['message'], message: 'Enter a message.' }] };
        },
      },
    };
    function loadMessages() {
      return new Promise(resolve => setTimeout(() => resolve([{ id: 'welcome', text: 'Welcome' }]), 20));
    }
    async function saveMessage(text) {
      await new Promise(resolve => setTimeout(resolve, text === 'alpha' ? 180 : 60));
      if (text === 'fail') throw new Error('The message was rejected.');
      return { id: text, text };
    }
    let added = [];
    function Loading() { return <p>Loading</p>; }
    export function DataFormsReadApp() {
      const initial = $read(loadMessages());
      const load = $track(initial);
      let total = added.length;
      const form = $forms({
        schema,
        action(fields) {
          const execution = $track(form);
          const temporary = { id: execution.id, text: fields.message, pending: true };
          added.push(temporary);
          execution.onSuccess(saved => {
            const index = added.indexOf(temporary);
            if (index !== -1) added.splice(index, 1, saved);
          });
          execution.onError(() => {
            const index = added.indexOf(temporary);
            if (index !== -1) added.splice(index, 1);
          });
          return saveMessage(fields.message);
        },
      });
      return <section>
        <h2>New messages ({total})</h2>
        <button type="button" onClick={() => load.refresh()}>Reload</button>
        {load.refreshing && <span>Refreshing...</span>}
        <Group pending={Loading}><ul>{initial.map(message => <li key={message.id}>{message.text}</li>)}</ul></Group>
        <ul>{added.map(message => <li key={message.id}>{message.text}{message.pending ? ' (sending)' : ''}</li>)}</ul>
        <form onSubmit={form.submit}>
          <input name="message" />
          <button type="submit">Send</button>
          {form.pending && <span>Sending...</span>}
          {form.errors.length > 0 && <p>{form.errors[0]?.message}</p>}
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
});

it('runs read refresh and overlapping form submissions with independent rollback', async () => {
  const { DataFormsReadApp } = await import(pathToFileURL(fixture).href);
  const html = await renderToStringAsync(DataFormsReadApp, { mode: 'resolve' });
  expect(html).toContain('Welcome');
  expect(html).toContain('<form');
  setScheduler(run => run());
  const root = DataFormsReadApp('App', null) as HTMLElement;
  document.body.append(root);
  await vi.waitFor(() => expect(root.textContent).toContain('Welcome'));

  const form = root.querySelector('form')!;
  const input = form.querySelector('input')!;
  const submit = (value: string) => {
    input.value = value;
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector('button') });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };

  submit('alpha');
  submit('a');
  submit('fail');
  await Promise.resolve();
  await Promise.resolve();
  expect(root.textContent).toContain('alpha (sending)');
  expect(root.textContent).toContain('a (sending)');
  expect(root.textContent).toContain('fail (sending)');
  expect(root.querySelector('h2')?.textContent).toBe('New messages (3)');

  await vi.waitFor(() => {
    expect(root.textContent).not.toContain('fail (sending)');
    expect(root.textContent).not.toContain('a (sending)');
    expect(root.textContent).toContain('The message was rejected.');
  });
  await vi.waitFor(() => {
    expect(root.textContent).not.toContain('alpha (sending)');
    expect(root.querySelector('h2')?.textContent).toBe('New messages (2)');
  });

  root.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
  expect(root.textContent).toContain('Refreshing...');
  await vi.waitFor(() => expect(root.textContent).not.toContain('Refreshing...'));
});
