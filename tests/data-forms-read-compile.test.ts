import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { render, renderToString } from '@memoized-dom/server';
import { _internals, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

describe('$read and $forms compiler integration', () => {
  afterEach(() => {
    for (const id of _internals().registry.keys()) unregister(id);
    document.body.replaceChildren();
    resetScheduler();
    vi.unstubAllGlobals();
  });
  it('retains promise creation for direct and bound reads', () => {
    const output = compileModules({
      './app.tsx': `
        import { $read, $track } from '@memoized-dom/data';
        function load(id) { return Promise.resolve({ id }); }
        export function App() {
          let id = 1;
          const direct = $read(load(id));
          const promise = load(id);
          const bound = $read(promise);
          const request = $track(bound);
          return <main><p>{direct.id}</p><p>{bound.id}</p><button onClick={() => request.refresh()}>Retry</button></main>;
        }
      `,
    }, {});
    const app = output['./app.tsx']!;
    expect(app).toMatch(/\$read\(load\(id\), \(\) => load\(id\)\)/);
    expect(app).toMatch(/\$read\(promise, \(\) => load\(id\)\)/);
  });

  it('keeps form pending reads and track calls live', () => {
    const output = compileModules({
      './app.tsx': `
        import { $forms, $track } from '@memoized-dom/data';
        export function App() {
          const form = $forms(async fields => fields.get('message'));
          const request = $track(form);
          return <form onSubmit={form.submit}>
            <input name="message" />
            <button disabled={form.pending}>{form.pending ? 'Sending' : 'Send'}</button>
            <output>{request.status}</output>
          </form>;
        }
      `,
    }, {});
    const app = output['./app.tsx']!;
    expect(app).toContain('$forms');
    expect(app).toContain('connectResolvedValue');
    expect(app).toContain('readResolvedValue(form,');
  });

  it('uses form-owned submit notifications and publishes later result mutations', async () => {
    const output = compileModules({
      './app.tsx': `
        import { $forms } from '@memoized-dom/data';
        export function App() {
          const form = $forms(fields => ({ message: String(fields.get('message')) }));
          return <form onSubmit={event => { form.submit(event); event.currentTarget.reset(); }}>
            <input name="message" /><button type="submit">Send</button>
            <button type="button" onClick={() => { form.result.message += '!'; }}>Edit</button>
            <span data-role="result">{form.hasResult ? form.result.message : 'Empty'}</span>
          </form>;
        }
      `,
    });
    const code = output['./app.tsx']!;
    // Only the result edit needs publication; submit publishes through its
    // frozen controller itself and must not add another source notification.
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'forms-read');
    mkdirSync(directory, { recursive: true });
    const fixture = join(directory, 'result-mutation.ts');
    writeFileSync(fixture, code);
    expect(code.match(/notifyResolvedValueMutation\(form\)/g)).toHaveLength(1);
    const { App } = await import(pathToFileURL(fixture).href);
    setScheduler(run => run());
    const form = App('FormsResultApp', null) as HTMLFormElement;
    document.body.append(form);
    form.querySelector('input')!.value = 'hello';
    form.dispatchEvent(new SubmitEvent('submit', {
      bubbles: true, cancelable: true, submitter: form.querySelector('button'),
    }));
    await vi.waitFor(() => expect(form.querySelector('[data-role="result"]')?.textContent).toBe('hello'));
    form.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    expect(form.querySelector('[data-role="result"]')?.textContent).toBe('hello!');
  });

  it('renders a form on the server and updates its compiled client UI after submission', async () => {
    const output = compileModules({
      './app.tsx': `
        import { $forms } from '@memoized-dom/data';
        export function App() {
          const form = $forms(async fields => String(fields.get('message')));
          return <form onSubmit={form.submit}>
            <input name="message" />
            <button disabled={form.pending}>{form.pending ? 'Sending' : 'Send'}</button>
            <output>{form.hasResult ? form.result : 'Empty'}</output>
          </form>;
        }
      `,
    }, {});
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'forms-read');
    mkdirSync(directory, { recursive: true });
    const fixture = join(directory, 'app.ts');
    writeFileSync(fixture, output['./app.tsx']!);
    const { App } = await import(pathToFileURL(fixture).href);
    expect(renderToString(App)).toContain('<form');

    setScheduler(run => run());
    const root = App('FormsApp', null) as HTMLFormElement;
    document.body.append(root);
    const input = root.querySelector('input')!;
    input.value = 'hello';
    const event = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: root.querySelector('button'),
    });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(root.querySelector('output')?.textContent).toBe('hello'));
    expect(root.querySelector('button')?.disabled).toBe(false);
  });

  it('resolves a compiled read on the server and replays its bound promise on refresh', async () => {
    const output = compileModules({
      './app.tsx': `
        import { $read, $track } from '@memoized-dom/data';
        export function App() {
          let id = 1;
          const promise = Promise.resolve({ id });
          const user = $read(promise);
          const request = $track(user);
          return <main>
            <span>{user.id}</span>
            <button onClick={() => { id++; request.refresh(); }}>Next</button>
          </main>;
        }
      `,
    }, {});
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'forms-read');
    mkdirSync(directory, { recursive: true });
    const fixture = join(directory, 'read.ts');
    writeFileSync(fixture, output['./app.tsx']!);
    const { App } = await import(pathToFileURL(fixture).href);
    expect((await render(App, { mode: 'resolve' })).html).toContain('<span>1</span>');

    setScheduler(run => run());
    const root = App('ReadApp', null) as HTMLElement;
    document.body.append(root);
    await vi.waitFor(() => expect(root.querySelector('span')?.textContent).toBe('1'));
    root.querySelector('button')!.click();
    await vi.waitFor(() => expect(root.querySelector('span')?.textContent).toBe('2'));
  });

  it.each(['const', 'export const'])('retries an outer %s promise in its creation scope despite component shadows', async declaration => {
    const load = vi.fn((endpoint: string): Promise<{endpoint: string; attempt: number}> =>
      Promise.resolve({endpoint, attempt: load.mock.calls.length}));
    vi.stubGlobal('__readReplayLoader', load);
    const output = compileModules({
      './app.tsx': `
        const endpoint = 'outer';
        ${declaration} promise = globalThis.__readReplayLoader(endpoint);
        const alias = promise;
        export function App() {
          const endpoint = 'shadow';
          const value = $read(alias);
          const request = $track(value);
          return <main><span>{value.endpoint}:{value.attempt}</span><button onClick={() => request.refresh()}>Retry</button></main>;
        }
      `,
    });
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'forms-read');
    mkdirSync(directory, { recursive: true });
    const fixture = join(directory, declaration === 'const' ? 'read-shadow.ts' : 'read-export-shadow.ts');
    writeFileSync(fixture, output['./app.tsx']!);
    const { App } = await import(pathToFileURL(fixture).href);
    setScheduler(run => run());
    const root = App('ReadShadowApp', null) as HTMLElement;
    document.body.append(root);
    await vi.waitFor(() => expect(root.querySelector('span')?.textContent).toBe('outer:1'));
    root.querySelector('button')!.click();
    await vi.waitFor(() => expect(root.querySelector('span')?.textContent).toBe('outer:2'));
    expect(load.mock.calls).toEqual([['outer'], ['outer']]);
  });

  it.each([
    ['object', 'const {promise} = {promise: Promise.resolve({id: 7})};'],
    ['array', 'const [promise] = [Promise.resolve({id: 7})];'],
  ])('refreshes a promise from %s destructuring without replaying its carrier', async (name, declaration) => {
    const output = compileModules({
      './app.tsx': `
        export function App() {
          ${declaration}
          const value = $read(promise);
          const request = $track(value);
          let refreshed = false;
          return <main><span>{value.id}</span>
            <button onClick={async () => { await request.refresh(); refreshed = true; }}>Retry</button>
            <output>{refreshed ? 'refreshed' : 'initial'}</output>
          </main>;
        }
      `,
    });
    const directory = join(import.meta.dirname, 'fixtures', 'out', 'forms-read');
    mkdirSync(directory, { recursive: true });
    const fixture = join(directory, `read-destructured-${name}.ts`);
    writeFileSync(fixture, output['./app.tsx']!);
    const {App} = await import(pathToFileURL(fixture).href);
    setScheduler(run => run());
    const root = App(`ReadDestructured${name}`, null) as HTMLElement;
    document.body.append(root);
    await vi.waitFor(() => expect(root.querySelector('span')?.textContent).toBe('7'));
    root.querySelector('button')!.click();
    await vi.waitFor(() => expect(root.querySelector('output')?.textContent).toBe('refreshed'));
    expect(root.querySelector('span')?.textContent).toBe('7');
  });
});
