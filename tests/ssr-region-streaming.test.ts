import { afterEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileModules } from '@memoized-dom/compiler';
import { renderToReadableStream } from '@memoized-dom/server';
import { mount, registerRootFactory, type MountedApplication } from '@memoized-dom/runtime';
import '@memoized-dom/runtime/hydrate';

const output = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'out', 'ssr-region-streaming.compiled.ts');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, compileModules({ './app.tsx': `
  import { $fetch, Group } from '@memoized-dom/data';

  function Skeleton() {
    return <i class="skeleton">Loading</i>;
  }

  export function App() {
    const slow = $fetch('/api/slow');
    const fast = $fetch('/api/fast');
    return (
      <main>
        <header id="static">Header</header>
        <Group pending={Skeleton}><section id="slow">{slow.title}</section></Group>
        <Group pending={Skeleton}><section id="fast">{fast.title}</section></Group>
      </main>
    );
  }
` })['./app.tsx']!);

interface CompiledApp {
  App(id: string, parent: null): Node;
}

function gatedFetch() {
  const gates = new Map<string, () => void>();
  const fetch = ((input: RequestInfo | URL) => new Promise<Response>(resolve => {
    const path = new URL(String(input), 'http://app.test').pathname;
    gates.set(path, () => resolve(Response.json({ title: `${path.slice(5)} title` })));
  })) as typeof globalThis.fetch;
  const open = async (path: string) => {
    await vi.waitFor(() => expect(gates.has(path)).toBe(true));
    gates.get(path)!();
  };
  return { fetch, open };
}

async function nextChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> {
  const { done, value } = await reader.read();
  return done ? null : new TextDecoder().decode(value);
}

async function remaining(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string[]> {
  const chunks: string[] = [];
  for (let chunk = await nextChunk(reader); chunk !== null; chunk = await nextChunk(reader)) chunks.push(chunk);
  return chunks;
}

/** Append streamed HTML like the parser does, running inline scripts in order. */
let currentScript: HTMLScriptElement | null = null;
Object.defineProperty(document, 'currentScript', { configurable: true, get: () => currentScript });
function appendStreamed(host: Element, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of [...template.content.childNodes]) {
    host.appendChild(node);
    if (node instanceof HTMLScriptElement && node.type === '') {
      currentScript = node;
      try { new Function(node.textContent ?? '')(); }
      finally { currentScript = null; }
    }
  }
}

let mounted: MountedApplication | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  delete (document as { readyState?: unknown }).readyState;
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for('memoized-dom:stream')];
});

async function render(fetch: typeof globalThis.fetch, timeout?: number) {
  const app = await import(/* @vite-ignore */ pathToFileURL(output).href) as CompiledApp;
  const stream = renderToReadableStream(app.App, {
    mode: 'stream', markers: true, fetch, ...(timeout === undefined ? {} : { timeout }),
  });
  return { app, reader: stream.getReader() };
}

function hostFor(app: CompiledApp): HTMLElement {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  registerRootFactory(app.App, { id: 'App', create: () => app.App('App', null) });
  return host;
}

describe('out-of-order region streaming', () => {
  it('sends the shell first, then each region in completion order', async () => {
    const server = gatedFetch();
    const { reader } = await render(server.fetch);

    const shell = (await nextChunk(reader))!;
    expect(shell).toContain('<header id="static">Header</header>');
    expect(shell.match(/class="skeleton"/g)).toHaveLength(2);
    expect(shell).toContain('"streamed":true');
    expect(shell).toContain('self.__mmdS=');

    await server.open('/api/fast');
    const fast = (await nextChunk(reader))!;
    expect(fast).toContain('fast title');
    expect(fast).not.toContain('slow title');
    expect(fast).toMatch(/^<template data-mmd-region="[^"]+">/);
    expect(fast).toContain('data-mmd-delta="App"');

    await server.open('/api/slow');
    const rest = (await remaining(reader)).join('');
    expect(rest).toContain('slow title');
    expect(rest).not.toContain('fast title');
  });

  it('patches regions before the browser program runs and hydrates them without refetching', async () => {
    const server = gatedFetch();
    const { app, reader } = await render(server.fetch);
    const host = hostFor(app);
    appendStreamed(host, (await nextChunk(reader))!);
    expect(host.querySelectorAll('.skeleton')).toHaveLength(2);

    await server.open('/api/slow');
    await server.open('/api/fast');
    for (const chunk of await remaining(reader)) appendStreamed(host, chunk);

    expect(host.querySelector('#slow')?.textContent).toBe('slow title');
    expect(host.querySelector('#fast')?.textContent).toBe('fast title');
    expect(host.querySelectorAll('.skeleton, template, script:not([type])')).toHaveLength(0);
    const serverSection = host.querySelector('#fast');

    const clientFetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', clientFetch);
    const onHydrateError = vi.fn();
    mounted = mount('root', app.App, { onHydrateError });
    await Promise.resolve();
    expect(onHydrateError).not.toHaveBeenCalled();
    expect(host.querySelector('#fast')).toBe(serverSection);
    expect(clientFetch).not.toHaveBeenCalled();
  });

  it('hands regions that arrive after mount to the hydrated root as data', async () => {
    const server = gatedFetch();
    const { app, reader } = await render(server.fetch);
    const host = hostFor(app);
    appendStreamed(host, (await nextChunk(reader))!);

    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    const clientFetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', clientFetch);
    const onHydrateError = vi.fn();
    mounted = mount('root', app.App, { onHydrateError });
    await Promise.resolve();
    expect(onHydrateError).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.skeleton')).toHaveLength(2);

    await server.open('/api/fast');
    appendStreamed(host, (await nextChunk(reader))!);
    await vi.waitFor(() => expect(host.querySelector('#fast')?.textContent).toBe('fast title'));
    expect(host.querySelectorAll('.skeleton')).toHaveLength(1);
    expect(host.querySelectorAll('template, script:not([type])')).toHaveLength(0);
    expect(clientFetch).not.toHaveBeenCalled();

    // The response ends without the slow region: the browser fetches it itself.
    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(String((clientFetch.mock.calls[0] as unknown[])[0])).toContain('/api/slow');
  });

  it('re-renders only the mismatched region and keeps the rest of the server DOM', async () => {
    const server = gatedFetch();
    const { app, reader } = await render(server.fetch);
    const host = hostFor(app);
    appendStreamed(host, (await nextChunk(reader))!);
    await server.open('/api/slow');
    await server.open('/api/fast');
    for (const chunk of await remaining(reader)) appendStreamed(host, chunk);

    // Something outside the program (an extension, a proxy) rewrote the
    // content of one region; its markers survived.
    const fast = host.querySelector('#fast')!;
    const text = [...fast.childNodes].find(node => node.nodeType === 3)!;
    const tampered = document.createElement('b');
    tampered.textContent = 'tampered';
    text.replaceWith(tampered);
    const header = host.querySelector('#static');
    const slowText = host.querySelector('#slow')!.textContent;
    const slowNode = [...host.querySelector('#slow')!.childNodes].find(node => node.nodeType === 3);

    const clientFetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', clientFetch);
    const onHydrateError = vi.fn();
    mounted = mount('root', app.App, { onHydrateError });
    expect(onHydrateError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'HydrationMismatchError' }), 'region');
    expect(host.querySelector('#static')).toBe(header);
    expect(host.querySelector('#fast')).toBe(fast);
    expect([...host.querySelector('#slow')!.childNodes].find(node => node.nodeType === 3)).toBe(slowNode);
    expect(host.querySelector('#slow')!.textContent).toBe(slowText);
    expect(fast.querySelector('b')).toBeNull();
    await vi.waitFor(() => expect(fast.textContent).toBe('fast title'));
  });

  it('stops at the settle budget and leaves undelivered sources to the browser', async () => {
    const server = gatedFetch();
    const { app, reader } = await render(server.fetch, 50);
    const host = hostFor(app);
    appendStreamed(host, (await nextChunk(reader))!);
    await server.open('/api/fast');
    for (const chunk of await remaining(reader)) appendStreamed(host, chunk);
    expect(host.querySelector('#fast')?.textContent).toBe('fast title');

    const clientFetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', clientFetch);
    mounted = mount('root', app.App);
    await Promise.resolve();
    expect(clientFetch).toHaveBeenCalledTimes(1);
    expect(String((clientFetch.mock.calls[0] as unknown[])[0])).toContain('/api/slow');
  });
});
