// @vitest-environment node
/** Request-only delivery uses the production async request storage. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { initialBootstrapDescriptor } from '@memoized-dom/runtime/server';
import { render, renderToString, renderToReadableStream, serve } from '../src/index';

const entry = `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`;
async function fixture(name: string, source: string) {
  const sources = { './main.ts': entry, './App.tsx': source };
  const server = compileModulesDetailed(sources, { initialContent: true, routedEnvironment: 'server', moduleStateCells: true });
  const client = compileModulesDetailed(sources, { initialContent: true, routedEnvironment: 'client' });
  const directory = join(import.meta.dirname, 'fixtures/out/initial-request', name);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'server.ts');
  writeFileSync(file, server.output['./App.tsx']!);
  return { server, client, serverModule: await import(/* @vite-ignore */ pathToFileURL(file).href) };
}

describe('request-only server delivery', () => {
  it.each(['component', 'module'])('settles concurrent request-only compositions independently with %s-owned data', async placement => {
    const declaration = `const user=$fetch('/api/user');`;
    const value = await fixture(`request-only-${placement}`, `${placement === 'module' ? declaration : ''}
      function Card({name}){return <section><h2 title={name}>{'Hello '+name}</h2></section>;}
      export function App(){${placement === 'component' ? declaration : ''}return <main><h1>Directory</h1><Card name={user?.name}/></main>;}`);
    const contract = value.server.initialDelivery!;
    expect(contract.browser).toBe('none');
    expect(contract).not.toHaveProperty('html');
    expect(contract.key).toBe(value.client.initialDelivery?.key);
    const releases: Array<() => void> = [];
    let calls = 0;
    const fetchFor = (name: string): typeof fetch => (async () => {
      calls++;
      await new Promise<void>(resolve => releases.push(resolve));
      return Response.json({ name });
    }) as typeof fetch;
    const options = { initialKey: contract.key, markers: true, mode: 'shell' as const };
    const first = render(value.serverModule.App, { ...options, fetch: fetchFor('Ada & <friends>') });
    const second = render(value.serverModule.App, { ...options, fetch: fetchFor('Grace') });
    await expect.poll(() => releases.length).toBe(2);
    releases[1]!(); releases[0]!();
    const results = await Promise.all([first, second]);
    expect(results[0]!.html).toContain('Hello Ada &amp; &lt;friends&gt;');
    expect(results[0]!.html).not.toContain('Grace');
    expect(results[1]!.html).toContain('Hello Grace');
    expect(results[1]!.html).not.toContain('Ada');
    for (const result of results) {
      expect(result.settlement.status).toBe('complete');
      expect(result.html).not.toMatch(/<!--|<script/);
      expect(result.payload).toEqual({ version: 1 });
      expect(result.scriptTag).toBe('');
    }
    expect(calls).toBe(2);
    expect(() => renderToString(value.serverModule.App, options)).toThrow('requires asynchronous rendering');
    await expect(render(value.serverModule.App, { ...options, initialKey: 'stale', fetch: fetchFor('Wrong') }))
      .rejects.toThrow('contracts do not match');
    expect(calls).toBe(2);
    const jsonFetch = (async () => Response.json({ name: 'Stream' })) as typeof fetch;
    const stream = renderToReadableStream(value.serverModule.App, { ...options, fetch: jsonFetch });
    expect(await new Response(stream).text()).toContain('<h2 title="Stream">Hello Stream</h2>');
    const ordinary = await render(value.serverModule.App, { mode: 'resolve', markers: true, fetch: jsonFetch });
    expect(ordinary.html).toContain('mmd:r:');
    expect(ordinary.scriptTag).toContain('application/mmd+json');
    expect(ordinary.payload.state?.sources.length).toBeGreaterThan(0);
  });

  it('rejects request-only timeouts and cancellation and releases pending fetches', async () => {
    const value = await fixture('request-timeout', `export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`);
    const signals: AbortSignal[] = [];
    const hangingFetch = ((_input: unknown, init?: RequestInit) => {
      signals.push(init!.signal!); return new Promise<Response>(() => {});
    }) as typeof fetch;
    const options = { initialKey: value.server.initialDelivery!.key, fetch: hangingFetch };
    await expect(render(value.serverModule.App, { ...options, timeout: 10 })).rejects.toThrow('did not settle');
    expect(signals[0]!.aborted).toBe(true);
    const controller = new AbortController();
    const pending = render(value.serverModule.App, { ...options, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('Disconnected');
    await expect.poll(() => signals.length).toBe(2);
    controller.abort(new Error('Disconnected'));
    await rejected;
    expect(signals[1]!.aborted).toBe(true);
  });

  it.each([false, true])('contains scheduled fetch failures within their render and preserves concurrent success (contract=%s)', async contract => {
    const value = await fixture(`request-failure-${contract}`, `export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`);
    const options = { mode: 'resolve' as const, ...(contract ? { initialKey: value.server.initialDelivery!.key } : {}) };
    const results = await Promise.allSettled([
      render(value.serverModule.App, { ...options, fetch: (async () => new Response('Unavailable', { status: 503 })) as typeof fetch }),
      render(value.serverModule.App, { ...options, fetch: (async () => Response.json({ name: 'Still isolated' })) as typeof fetch }),
    ]);
    expect(results[0]!.status).toBe('rejected');
    if (results[0]!.status === 'rejected') expect(results[0]!.reason.message).toContain('503');
    expect(results[1]!.status).toBe('fulfilled');
    if (results[1]!.status === 'fulfilled') expect(results[1]!.value.html).toBe('<h1>Still isolated</h1>');
  });

  it.each(['shell', 'resolve'] as const)('serves request-only HTML after settlement with a %s policy and reports failures before commit', async mode => {
    const value = await fixture(`request-handler-${mode}`, `export function App(){const user=$fetch('/api/user');return <main><h1>{user?.name}</h1></main>;}`);
    const contract = value.server.initialDelivery!;
    const application = serve();
    let fail = false;
    application.get('/api/user', () => fail
      ? new Response('Unavailable', { status: 503 }) : { name: 'Ada' });
    application.ssr(value.serverModule.App, { mode, delivery: 'stream', timeout: 20 });
    (application as unknown as { installDocumentTemplate(template: string): void }).installDocumentTemplate(
      `<html><head></head><body><div id="root"><!--ssr-outlet--></div></body></html>` +
      initialBootstrapDescriptor({ key: contract.key, target: 'root', browser: 'none' }));
    const response = await application.fetch(new Request('https://app.test/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<main><h1>Ada</h1></main>');
    expect(html).not.toMatch(/<script|mmd:r:|initial-delivery/);
    fail = true;
    const failed = await application.fetch(new Request('https://app.test/'));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('<main>');
  });

});
