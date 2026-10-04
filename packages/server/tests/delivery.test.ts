// @vitest-environment node
/**
 * SSR delivery contract through serve().fetch():
 * - `stream` commits headers once route preparation decides the response,
 *   flushes the document head immediately, then emits the atomic body;
 * - a post-commit failure closes the document with an empty outlet so the
 *   client mounts fresh, and is reported through `onRender`;
 * - client disconnects and HEAD requests stop request-owned work;
 * - `buffer` responds with the complete document and Server-Timing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { serve, type RenderReport, type ServerApplication } from '../src/index';
import { compileFixture, type CompiledTiers } from './parity-harness';

const TEMPLATE = '<!doctype html><head><title>t</title></head><body><!--ssr-outlet--></body>';
const PREFIX = '<!doctype html><head><title>t</title></head><body>';

let fixture: CompiledTiers;

beforeAll(async () => {
  fixture = await compileFixture('delivery-app', `
    import { $fetch, Group } from '@memoized-dom/data';

    function Pending() {
      return <p class="pending">Loading</p>;
    }

    export function App() {
      const user = $fetch('/api/user');
      return (
        <main>
          <Group pending={Pending}>
            <h1>{user.name}</h1>
          </Group>
        </main>
      );
    }
  `);
});

interface Harness {
  app: ServerApplication;
  reports: RenderReport[];
  release: () => void;
  apiSignals: AbortSignal[];
}

function createApp(
  configure: (app: ServerApplication) => void = app => app.ssr(fixture.serverModule.App),
  options: Parameters<typeof serve>[0] = {},
): Harness {
  const reports: RenderReport[] = [];
  const apiSignals: AbortSignal[] = [];
  const gate = Promise.withResolvers<void>();
  const app = serve({ ...options, onRender: report => reports.push(report) });
  app.get('/api/user', async context => {
    apiSignals.push(context.request.signal);
    await gate.promise;
    return { name: 'Ada' };
  });
  configure(app);
  (app as unknown as { installDocumentTemplate(template: string): void })
    .installDocumentTemplate(TEMPLATE);
  return { app, reports, release: gate.resolve, apiSignals };
}

const decoder = new TextDecoder();

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

describe('SSR delivery', () => {
  it('commits headers and the document head before request data settles', async () => {
    const harness = createApp();
    const response = await harness.app.fetch(new Request('https://app.test/'));
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const head = await reader.read();
    expect(decoder.decode(head.value)).toBe(PREFIX);
    expect(harness.reports).toEqual([]);

    harness.release();
    const rest = await readAll(reader);
    expect(rest.startsWith('<!--mmd:r:App--><main><h1>')).toBe(true);
    expect(rest).toContain('Ada');
    expect(rest).not.toContain('class="pending"');
    expect(rest).toContain('<script type="application/mmd+json"');
    expect(rest.endsWith('</body>')).toBe(true);
    await expect.poll(() => harness.reports.map(report => report.outcome))
      .toEqual(['complete']);
  });

  it('closes a document with an empty outlet when the body fails after commit', async () => {
    const harness = createApp(app => app.ssr(fixture.serverModule.App, { deadline: 40 }));
    const response = await harness.app.fetch(new Request('https://app.test/'));
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toBe(TEMPLATE.replace('<!--ssr-outlet-->', ''));
    expect(html).not.toContain('mmd:r:');
    expect(harness.reports.map(report => report.outcome)).toEqual(['deadline']);
    expect(harness.apiSignals[0]!.aborted).toBe(true);
  });

  it('stops request-owned work when the client disconnects mid-stream', async () => {
    const harness = createApp();
    const response = await harness.app.fetch(new Request('https://app.test/'));
    const reader = response.body!.getReader();
    await reader.read();
    await expect.poll(() => harness.apiSignals.length).toBe(1);

    await reader.cancel(new DOMException('client went away', 'AbortError'));
    expect(harness.apiSignals[0]!.aborted).toBe(true);
    await expect.poll(() => harness.reports.map(report => report.outcome))
      .toEqual(['aborted']);
  });

  it('answers HEAD after preparation without rendering the body', async () => {
    const harness = createApp();
    const response = await harness.app.fetch(
      new Request('https://app.test/', { method: 'HEAD' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toBe('');
    await expect.poll(() => harness.apiSignals[0]?.aborted).toBe(true);
  });

  it('buffers per-registration, overriding application defaults', async () => {
    const harness = createApp(
      app => app.ssr('/landing', fixture.serverModule.App, {
        delivery: 'buffer',
        mode: 'shell',
        markers: false,
      }),
      { render: { mode: 'resolve' } },
    );
    const response = await harness.app.fetch(new Request('https://app.test/landing'));
    const html = await response.text();
    expect(html).toContain('class="pending"');
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('application/mmd+json');
    expect(response.headers.get('server-timing')).toMatch(/^ssr;dur=[\d.]+;desc="shell"$/);
    expect(harness.reports.map(report => [report.delivery, report.outcome]))
      .toEqual([['buffer', 'shell']]);
  });
});
