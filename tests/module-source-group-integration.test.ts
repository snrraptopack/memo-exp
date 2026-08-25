/**
 * RFC §16.4 regression battery — module-scope sources consumed through the
 * component-local machinery (Group, $track, derivations).
 *
 * Guards three classes of bugs that slipped through per-feature tests:
 * 1. Group status-test arrays must keep holder refs (refs), not resolved
 *    payloads — nesting a materializing read inside resolvedValuesError/
 *    Pending throws `Value is not a fetch resource` at runtime.
 * 2. $track/$ops arguments must keep receiving the ref; wrapping them in
 *    readResolvedValue throws UnresolvedDataReadError before first commit.
 * 3. Derived values over module refs (unread = list.filter().length) must
 *    gate through deriveResolvedValues instead of imperative reads.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  createApplicationRuntime,
  runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import { renderToString } from '@memoized-dom/server';
import {
  resetScheduler,
  setScheduler,
} from '@memoized-dom/runtime/testing';
import {
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';

const outDir = join(import.meta.dirname, 'fixtures', 'out', 'mmd-module-group');

const sessionSource = `
  import { $fetch } from '@memoized-dom/data';
  export interface Item { id: string; text: string; read: boolean }
  export const notifications = $fetch<Item[]>('/api/items');
`;

const appSource = `
  import { $track, $ops, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
  import { notifications } from './session';

  function Skeleton() {
    return <ul class="list"><li class="skeleton">...</li></ul>;
  }

  function ErrorRow({ error, retry }: { error: { message: string }; retry: () => void }) {
    return <div class="error">{error.message}<button onClick={retry}>Retry</button></div>;
  }

  export function Panel() {
    const state = $track(notifications);
    const unread = notifications.filter((n) => !n.read).length;
    return (
      <section>
        <span class="pill" class={{ busy: state.refreshing }}>{unread} unread</span>
        <button onClick={() => void $ops(notifications).refresh()}>Refresh</button>
        <Group data={notifications}>
          <Pending component={Skeleton} />
          <ErrorArm component={ErrorRow} />
          <ul class="list">
            {notifications.map((n) => (
              <li key={n.id} class={n.read ? 'read' : 'unread'}>{n.text}</li>
            ))}
          </ul>
        </Group>
      </section>
    );
  }
`;

const modules = {
  './session.ts': sessionSource,
  './panel.tsx': appSource,
};

function compile(): Record<string, string> {
  return compileModules(modules, {});
}

describe('module-scope sources through Group/$track/derivations', () => {
  const written: string[] = [];

  it('keeps group status tests on holder refs, not resolved payloads', () => {
    const out = compile();
    const panel = out['./panel.tsx']!;
    writeCompiled('group-status-refs', panel);
    // resolvedValuesError/Pending receive the ref itself...
    expect(panel).toMatch(/resolvedValuesError\(\[notifications\]\)/);
    expect(panel).toMatch(/resolvedValuesPending\(\[notifications\]\)/);
    // ...never a nested materializing read inside the test arrays
    expect(panel).not.toMatch(
      /resolvedValues(?:Error|Pending)\(\[_MDD\.readResolved/,
    );
  });

  it('leaves $track and $ops arguments untouched', () => {
    const out = compile();
    const panel = out['./panel.tsx']!;
    writeCompiled('track-passthrough', panel);
    expect(panel).toContain('$track(notifications)');
    expect(panel).toContain('$ops(notifications)');
    // The throwing imperative guard must not wrap passthrough arguments
    expect(panel).not.toMatch(
      /readResolvedValue\([^)]*"[^"]*notifications[^"]*"\s*\)\)\.\s*(refresh|pending|refreshing)/,
    );
    expect(panel).not.toMatch(/\$track\(_?MDD\.readResolvedValue/);
  });

  it('gates derived collections via deriveResolvedValues, not throws', () => {
    const out = compile();
    const panel = out['./panel.tsx']!;
    writeCompiled('derived-gated', panel);
    expect(panel).toMatch(
      /deriveResolvedValues\(\[notifications\], \w+ => \w+\.filter/,
    );
    // No bare imperative read of the module source at creation time
    expect(panel).not.toMatch(/let unread = _MDD\.readResolvedValue\(/);
  });

  it('renders pending state without throwing, request-locally', async () => {
    const out = compile();
    writeAll(out);
    await import(pathToFileURL(join(outDir, 'session.ts')).href);
    const { Panel } = await import(
      pathToFileURL(join(outDir, 'panel.ts')).href
    );
    expect(typeof Panel).toBe('function');

    let calls = 0;
    const never = (() => {
      calls++;
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    const makeRequest = (id: string) =>
      createApplicationRuntime(id);

    const a = makeRequest('a');
    const b = makeRequest('b');
    runWithApplicationRuntime(a, () => {
      const html = renderToString(Panel, { fetch: never });
      expect(html).toContain('skeleton');
      expect(html).not.toContain('<li class="unread"');
    });
    runWithApplicationRuntime(b, () => {
      renderToString(Panel, { fetch: never });
    });
    await Promise.resolve();
    await Promise.resolve();
    // Each ApplicationRuntime materializes its own module-source instance.
    expect(calls).toBe(2);
    void b;
  });

  it('commits rows client-side after async data arrives', async () => {
    const out = compile();
    writeAll(out);
    await import(pathToFileURL(join(outDir, 'session.ts')).href);
    const { Panel } = await import(
      pathToFileURL(join(outDir, 'panel.ts')).href,
    );
    document.body.innerHTML = '';
    const { promise: itemsRequest, resolve: resolveItems } =
      Promise.withResolvers<Response>();
    const fetchJson = (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/items')) return itemsRequest;
      return Promise.resolve(Response.json({ id: 1, name: 'A' }));
    };
    setActiveDataRuntime(createDataRuntime({ fetch: fetchJson }));

    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);
    host.appendChild(Panel('App', null) as unknown as Node);
    expect(document.querySelector('.skeleton')).not.toBeNull();

    resolveItems(
      Response.json([{ id: 'n1', text: 'Deploy done', read: false }]),
    );
    // Commit flush runs on the runtime scheduler; drain microtasks until the
    // row appears instead of guessing a wall-clock delay.
    for (let i = 0; i < 50; i++) {
      await Promise.resolve();
      if (document.querySelector('.unread') !== null) break;
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    expect(document.querySelector('.unread')?.textContent).toContain(
      'Deploy done',
    );
    expect(document.querySelector('.skeleton')).toBeNull();
    expect(document.querySelector('section span')?.textContent).toContain(
      '1 unread',
    );
    void fetchJson;
  });

  it('workspace example: badge and rows commit client-side', async () => {
    const fixtures = join(
      import.meta.dirname,
      'fixtures',
      'out',
      'ws-e2e',
    );
    await import(pathToFileURL(join(fixtures, 'api.ts')).href);
    await import(pathToFileURL(join(fixtures, 'session.ts')).href);
    const { WorkspaceApp } = await import(
      pathToFileURL(join(fixtures, 'WorkspaceApp.ts')).href
    );
    // Synchronous commits make the cross-source invalidation deterministic:
    // any remaining failure is a logic bug, not a timing artifact.
    setScheduler((fn) => fn());

    document.body.innerHTML = '';
    const { promise: itemsRequest, resolve: resolveItems } =
      Promise.withResolvers<Response>();
    // Session commits on a real 400ms timer, mirroring the workspace mock:
    // this exercises commit-arrives-later invalidation, which an
    // already-resolved promise cannot catch.
    const { promise: sessionRequest, resolve: resolveSession } =
      Promise.withResolvers<Response>();
    setTimeout(() => resolveSession(Response.json({ id: 1, name: 'Ada Lovelace', email: 'ada@ws' })), 400);
    const fetchJson = (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/items')) return itemsRequest;
      if (url.includes('/api/session')) return sessionRequest;
      return Promise.resolve(Response.json({}));
    };
    setActiveDataRuntime(createDataRuntime({ fetch: fetchJson }));

    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);
    host.appendChild(WorkspaceApp('App', null) as unknown as Node);
    expect(document.querySelector('.avatar')?.textContent).toBe('');

    const errors: string[] = [];
    const onErr = (event: ErrorEvent): void => {
      errors.push(String(event.message));
    };
    window.addEventListener('error', onErr);
    resolveItems(
      Response.json([{ id: 'n1', text: 'Deploy done', read: false }]),
    );
    // Both sources commit through real async boundaries (the session on a
    // 400ms timer); poll the live DOM instead of draining a fixed number of
    // microtasks, which cannot observe timer-scheduled commits.
    await vi.waitFor(() => {
      expect(document.querySelector('.unread')?.textContent).toContain(
        'Deploy done',
      );
    }, { timeout: 3000, interval: 20 });
    await vi.waitFor(() => {
      expect(document.querySelector('.avatar')?.textContent).toBe('A');
      expect(document.querySelector('.who strong')?.textContent).toBe(
        'Ada Lovelace',
      );
    }, { timeout: 3000, interval: 20 });
    window.removeEventListener('error', onErr);
    resetScheduler();
  });

  function writeCompiled(name: string, code: string): void {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${name}.js`), code);
    written.push(name);
  }

  function writeAll(out: Record<string, string>): void {
    mkdirSync(outDir, { recursive: true });
    for (const [id, code] of Object.entries(out)) {
      const file = id.replace('./', '').replace(/\.tsx$/, '.ts');
      writeFileSync(join(outDir, file), code);
    }
  }
});
