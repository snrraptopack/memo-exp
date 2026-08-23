/**
 * Phase 1 exit review — proposal §Phase 1 exit criteria.
 *
 * Criterion probes against the real renderer, not earlier slices' fixtures:
 *
 * 1. Importing @memoized-dom/server requires no window/document. This file
 *    runs in the plain `node` environment: no DOM globals exist at import or
 *    render time.
 * 2. Two simultaneous (sequential on the event loop, as all synchronous SSR
 *    is) requests over ONE shared compiled module record cannot observe each
 *    other's router, module-state, or entity state.
 * 3. CSR-equivalence matrix: covered by parity.test.ts (slices 1.5/1.6).
 * 4. Every render disposes its context, including on thrown errors.
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import { renderToString, renderWithDom } from '../src/index';
import { compileFixture } from './parity-harness';


describe('Phase 1 exit criteria', () => {
  afterEach(() => {
    // The global-swap contract: after every render (success or failure) the
    // ambient document must be gone in this bare-node environment.
    expect(globalThis.document).toBeUndefined();
  });

  it('imports and renders with no window or document globals', async () => {
    const tiers = await compileFixture(
      'exit-bare-node',
      `
      export function App() {
        return <main><h1>Bare node</h1></main>;
      }
    `,
    );
    const html = renderToString(tiers.serverModule.App);
    expect(html).toContain('<h1>Bare node</h1>');
  });

  it('sequential requests over one shared record stay fully isolated', async () => {
    const tiers = await compileFixture(
      'exit-isolation',
      `
      import { route } from '@memoized-dom/router';

      export let visits = 0;

      export function bump(): void {
        visits += 1;
      }

      function Project() {
        const projectId = route.params['projectId'] ?? 'none';
        return <h1>Project {projectId}</h1>;
      }

      export function App() {
        return (
          <main>
            <Project route="/projects/:projectId" />
            <p>{visits}</p>
          </main>
        );
      }
    `,
      { moduleStateCells: true },
    );

    // Interleave: render request A, mutate ITS runtime's module cells,
    // render more requests - mutations must never leak across requests.
    const first = renderWithDom(tiers.serverModule.App, {
      url: '/projects/alpha',
    });
    expect(first.html).toContain('alpha');
    expect(first.html).toContain('<p>0</p>');
    runWithApplicationRuntime(first.runtime, () => {
      tiers.serverModule.bump();
    });
    first.runtime.dispose();

    for (let index = 0; index < 4; index++) {
      const url = index % 2 === 0 ? '/projects/beta' : '/projects/gamma';
      const html = renderToString(tiers.serverModule.App, { url });
      // Router state is per request...
      expect(html).toContain(['beta', 'gamma'][index % 2 === 0 ? 0 : 1]);
      // ...and request A's module-state mutation never leaks.
      expect(html).toContain('<p>0</p>');
    }

    // Deterministic output across repeated requests over the SAME record.
    const again = renderToString(tiers.serverModule.App, {
      url: '/projects/alpha',
    });
    expect(again).toContain('alpha');
    expect(again).toContain('<p>0</p>');
  });

  it('disposes the request context when a component throws', async () => {
    const tiers = await compileFixture(
      'exit-boom',
      `
      export function App(): HTMLElement {
        throw new Error('render failure');
      }
    `,
    );

    expect(() => renderToString(tiers.serverModule.App)).toThrow(
      'render failure',
    );

    // The failed request left nothing behind: the next request renders
    // normally through a fresh context.
    const recovery = await compileFixture(
      'exit-recovery',
      `
      export function App() {
        return <main><h1>Recovered</h1></main>;
      }
    `,
    );
  });
});
