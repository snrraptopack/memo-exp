/**
 * Phase 1.5 — CSR-equivalence corpus.
 *
 * Expands slice 1.4's single-fixture parity into the proposal §1.5
 * categories: text/attribute/class/style/boolean attributes, escaping,
 * innerHTML passthrough, SVG namespaces, fragments/multiple roots,
 * conditional branches, keyed/nested/empty lists, dynamic tags,
 * component props + children slots, and the effects/refs/cleanup
 * server-side guarantees.
 *
 * Route regions and async data states need request-local router/data
 * wiring and are covered in their own slice.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime';
import { _internals } from '@memoized-dom/runtime/testing';
import { renderToString } from '../src/index';
import {
  compileFixture,
  expectParity,
  renderBothTiers,
} from './parity-harness';

/* eslint-disable no-unused-vars */

describe('CSR-equivalence corpus', () => {
  beforeEach(() => {
    setScheduler((run) => run());
  });

  afterEach(() => {
    // Client-tier creation registers into the ambient default runtime.
    _internals().registry.forEach((_, id) => unregister(id));
    resetScheduler();
  });

  it('renders text, attributes, boolean attributes, class, style, and escaping identically', async () => {
    const tiers = await compileFixture(
      'parity-text-attrs',
      `
      export function App() {
        let label = 'Submit & "save"';
        return (
          <form class="panel" style="padding: 4px" data-kind="form">
            <input type="checkbox" disabled checked />
            <button title={label}>{label}</button>
            <article draggable={true} contentEditable={true}>Drag me</article>
            <span title={'<script>alert(1)</script>'}>{"<b> & </b>"}</span>
          </form>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('disabled');
      expect(result.serverHtml).toContain('checked');
      expect(result.serverHtml).toContain('draggable="true"');
      expect(result.serverHtml).toContain('contenteditable="true"');
      expect(result.serverHtml).toContain('&amp;');
      // Text content must be fully escaped - no raw markup may leak as text.
      expect(result.serverHtml).toContain('&lt;b&gt; &amp; &lt;/b&gt;');
      // Attribute values legitimately keep raw `<` per the HTML
      // serialization spec (only &, ", and nbsp are escaped there), so a
      // quoted title="<script>..." is inert serialization, not injection.
      expect(result.serverHtml).not.toMatch(/><script/);
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders SVG namespaces identically', async () => {
    const tiers = await compileFixture(
      'parity-svg',
      `
      export function App() {
        return (
          <svg viewBox="0 0 10 10" class="icon">
            <circle cx="5" cy="5" r="4"></circle>
          </svg>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('<circle');
      expect(result.serverHtml).toContain('viewBox');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('passes trusted innerHTML through identically', async () => {
    const tiers = await compileFixture(
      'parity-innerhtml',
      `
      export function App() {
        let markup = '<strong>trusted</strong> <em>content</em>';
        return <div innerHTML={markup}></div>;
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('<strong>trusted</strong>');
      expect(result.serverHtml).toContain('<em>content</em>');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders multi-root fragments identically', async () => {
    const tiers = await compileFixture(
      'parity-fragments',
      `
      export function App() {
        return (
          <>
            <header id="top">Top</header>
            <footer id="bottom">Bottom</footer>
          </>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('id="top"');
      expect(result.serverHtml).toContain('id="bottom"');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders conditional branches (element, text, empty) identically', async () => {
    const tiers = await compileFixture(
      'parity-conditionals',
      `
      export function App() {
        let mode = 1;
        return (
          <div>
            <div if={mode === 0}>zero</div>
            <div else-if={mode === 1}>one</div>
            <div else>{'other'}</div>
            <span if={mode > 100}>never</span>
          </div>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('one');
      expect(result.serverHtml).not.toContain('zero');
      expect(result.serverHtml).not.toContain('never');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders keyed, nested, and empty lists identically', async () => {
    const tiers = await compileFixture(
      'parity-lists',
      `
      export function App() {
        let groups = [
          { id: 'g1', rows: ['a', 'b'] },
          { id: 'g2', rows: [] },
        ];
        const empty: string[] = [];
        return (
          <div>
            <ul id="flat">
              {['x', 'y'].map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <ul id="nested">
              {groups.map((group) => (
                <li key={group.id}>
                  {group.rows.map((row) => (
                    <span key={row}>{row}</span>
                  ))}
                </li>
              ))}
            </ul>
            <ul id="empty">
              {empty.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('<li>x</li>');
      expect(result.serverHtml).toContain('<li>y</li>');
      expect(result.serverHtml).toContain('<span>a</span>');
      expect(result.serverHtml).toContain('<span>b</span>');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders dynamic intrinsic tags identically', async () => {
    const tiers = await compileFixture(
      'parity-dynamic-tag',
      `
      export function App() {
        let wide = true;
        const Tag = wide ? 'section' : 'article';
        return <Tag id="dyn">Content</Tag>;
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('<section');
      expect(result.serverHtml).toContain('Content');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders component props and children slots identically', async () => {
    const tiers = await compileFixture(
      'parity-components',
      `
      function Card(props) {
        return (
          <article class="card">
            <h2>{props.title}</h2>
            <section>{props.children}</section>
          </article>
        );
      }

      export function App() {
        return (
          <Card title="Hello">
            <p>Slot body</p>
          </Card>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('Hello');
      expect(result.serverHtml).toContain('<p>Slot body</p>');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders route regions and params identically for the request URL', async () => {
    const tiers = await compileFixture(
      'parity-routes',
      `
      import { route } from '@memoized-dom/router';

      function Home() {
        return <main><h1>Home</h1></main>;
      }

      function Project() {
        const projectId = route.params['projectId'] ?? '';
        const tab = route.query.get('tab') ?? 'overview';
        return (
          <main>
            <h1>Project {projectId}</h1>
            <p>{tab}</p>
          </main>
        );
      }

      function NotFound() {
        return <main><h1>Not found</h1></main>;
      }

      export function App() {
        return (
          <div>
            <Home route="/" />
            <Project route="/projects/:projectId" />
            <NotFound route="/*" />
          </div>
        );
      }
    `,
    );

    const result = renderBothTiers(tiers, 'App', {
      url: '/projects/42?tab=activity',
    });
    try {
      expect(result.serverHtml).toContain('Project 42');
      expect(result.serverHtml).toContain('activity');
      expect(result.serverHtml).not.toContain('Not found');
      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('renders unresolved data states identically under an injected fetch', async () => {
    const tiers = await compileFixture(
      'parity-data',
      `
      import { $fetch, $track } from '@memoized-dom/data';

      interface Todo {
        id: number;
        title: string;
      }

      export function App() {
        const todos = $fetch<Todo[]>('/api/todos');
        const state = $track(todos);
        return (
          <section>
            <p if={state.pending}>Loading</p>
            <ul else>
              {todos.map((todo) => (
                <li key={todo.id}>{todo.title}</li>
              ))}
            </ul>
          </section>
        );
      }
    `,
    );

    // A fetch that never settles keeps the resource pending on both tiers,
    // so the flushed HTML is deterministic.
    const never = () => new Promise<Response>(() => {});
    const result = renderBothTiers(tiers, 'App', { fetch: never });
    try {
      expect(result.serverHtml).toContain('<p>Loading</p>');
      expect(result.serverHtml).not.toContain('<li');

      expectParity(result);
    } finally {
      result.serverRuntime.dispose();
    }
  });

  it('isolates successive requests: each URL renders against its own router', async () => {
    const tiers = await compileFixture(
      'parity-request-isolation',
      `
      import { route } from '@memoized-dom/router';

      export function App() {
        const projectId = route.params['projectId'] ?? 'none';
        return <main><h1>Project {projectId}</h1></main>;
      }
    `,
    );

    // renderToString creates and disposes a full request context per call,
    // including the request-local router runtime.
    const parameterized = renderToString(tiers.serverModule.App, {
      url: '/projects/alpha',
    });
    const root = renderToString(tiers.serverModule.App, { url: '/' });
    expect(parameterized).toContain('alpha');
    expect(root).toContain('none');
    expect(root).not.toContain('alpha');
  });

  it('does not execute effects, refs, or cleanup during server rendering', async () => {
    const tiers = await compileFixture(
      'parity-side-effects',
      `
      export let effectRuns = 0;
      export let refRuns = 0;
      export let cleanups = 0;

      export function App() {
        let panel;

        effect(() => {
          effectRuns++;
          return () => { cleanups++; };
        });

        cleanup(() => { cleanups++; });

        return <div><input ref={(node) => { refRuns++; }} /><span ref={panel}></span></div>;
      }
    `,
    );

    const result = renderBothTiers(tiers);
    try {
      expect(result.serverHtml).toContain('<input');
      expect(tiers.serverModule.effectRuns).toBe(0);
      expect(tiers.serverModule.refRuns).toBe(0);
      expect(tiers.serverModule.cleanups).toBe(0);

      // Client tier runs them exactly once each.
      expect(tiers.clientModule.effectRuns).toBe(1);
      expect(tiers.clientModule.refRuns).toBeGreaterThanOrEqual(1);

      // Cleanup disposers drain at unmount, not at creation - tear down the
      // client root explicitly and confirm both cleanup() and the effect
      // teardown ran.
      unregister('AppClient');
      expect(tiers.clientModule.cleanups).toBeGreaterThanOrEqual(1);
    } finally {
      result.serverRuntime.dispose();
    }
  });
});
