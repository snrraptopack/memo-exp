/**
 * Application root — one compiled component, two rendering targets.
 *
 * Routing uses compiler-owned JSX directives (guide §Routing):
 *
 *   `route="/"` on the root element registers the application route graph.
 *   Nested `route="..."` siblings are mutually exclusive — the compiler
 *   activates only the matching region for the current URL, both on the server
 *   (URL-driven, memory history) and in the browser (pushState).
 *
 *   `route-to="..."` on an anchor compiles to a real `href` plus a client-side
 *   navigation handler. No manual `onClick` or `navigate()` needed.
 *
 * Data loading uses colorless module sources from session.ts. Reading
 * `currentUser.name` or iterating `stories` is a live reactive read — no
 * selector or subscription call required. `Group` renders the pending/error
 * arms while sources are in flight; ordinary data writes propagate to every
 * dependent reader immediately.
 */
import { route } from '@memoized-dom/router';
import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import {
  currentUser,
  stories,
  type Story,
} from './session';


// ── Session badge ─────────────────────────────────────────────────────────────

function SessionPending() {
  return <span class="badge loading">…</span>;
}

function SessionError({ error, retry: _retry }: { error: { message: string }; retry: () => void }) {
  return <span class="badge error">{error.message}</span>;
}

function SessionBadge() {
  return (
    <Group>
      <Pending component={SessionPending} />
      <ErrorArm component={SessionError} />
      <span class="badge user">
        <span class="avatar">{currentUser.avatar}</span>
        {currentUser.name}
      </span>
    </Group>
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────

function Nav() {
  // `route.pathname` is a reactive read: re-renders only the Nav subtree on
  // each navigation. Derive active state from it without any matching helper.
  const p = route.pathname;

  return (
    <nav class="nav">
      <a route-to="/" class={p === '/' ? 'nav-link active' : 'nav-link'}>
        Dashboard
      </a>
      <a route-to="/stories" class={p.startsWith('/stories') ? 'nav-link active' : 'nav-link'}>
        Stories
      </a>
      <a route-to="/about" class={p.startsWith('/about') ? 'nav-link active' : 'nav-link'}>
        About
      </a>
    </nav>
  );
}

// ── Dashboard view ────────────────────────────────────────────────────────────

function DashboardPending() {
  return <p class="muted">Loading metrics…</p>;
}

function DashboardError({ error, retry: _retry }: { error: { message: string }; retry: () => void }) {
  return <p class="panel-error">{error.message}</p>;
}

function Dashboard() {
  return (
    <section class="panel">
      <div class="panel-head"><h2>Dashboard</h2></div>
      <Group>
        <Pending component={DashboardPending} />
        <ErrorArm component={DashboardError} />
        <div class="stats">
          <div class="stat">
            <span class="stat-value">{stories.length}</span>
            <span class="stat-label">stories</span>
          </div>
          <div class="stat">
            <span class="stat-value">
              {stories.reduce((total, item) => total + item.votes, 0)}
            </span>
            <span class="stat-label">votes</span>
          </div>
        </div>
      </Group>
    </section>
  );
}

// ── Stories view ──────────────────────────────────────────────────────────────

function StoriesPending() {
  return (
    <ul class="list">
      <li class="story skeleton">Loading…</li>
    </ul>
  );
}

function StoriesError({ error, retry }: { error: { message: string }; retry: () => void }) {
  return (
    <div class="panel-error">
      {error.message}
      <button class="action" onClick={retry}>Retry</button>
    </div>
  );
}

function StoryRow({ item }: { item: Story }) {
  function handleUpvote() {
    item.votes++;
  }

  return (
    <li class="story">
      <button
        class="vote"
        aria-label={`Upvote ${item.title}`}
        onClick={handleUpvote}
      >
        ▲
      </button>
      <div class="story-body">
        <span class="story-title">{item.title}</span>
        <span class="story-meta">
          {`${item.category} · ${item.author} · ${item.posted}`}
        </span>
      </div>
      <span class="votes">{item.votes}</span>
    </li>
  );
}

function Stories() {
  function handlePublish() {
    const tempId = Date.now();
    const nextNumber = stories.length + 1;
    const tempStory: Story = {
      id: tempId,
      title: `Fresh signal #${nextNumber} — published live`,
      category: 'Live',
      author: currentUser.name || 'you',
      votes: 1,
      posted: 'just now',
    };

    stories.unshift(tempStory);
  }

  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Top stories</h2>
        <button class="action" onClick={handlePublish}>
          + Publish
        </button>
      </div>
      <Group>
        <Pending component={StoriesPending} />
        <ErrorArm component={StoriesError} />
        <ul class="list">
          {stories.map((item) => <StoryRow item={item} key={item.id} />)}
        </ul>
      </Group>
    </section>
  );
}

// ── About view ────────────────────────────────────────────────────────────────

function About() {
  return (
    <section class="panel">
      <div class="panel-head"><h2>About this page</h2></div>
      <p class="muted">
        The HTML you are reading was streamed from the server, and hydration
        adopted it in place — the state envelope embedded in the document
        satisfied every data source, so the client issued zero duplicate
        requests. Navigate with the links above: routing is client-side after
        hydration and a full server render on a hard reload.
      </p>
    </section>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    // `route="/"` on the outermost element registers this as the application
    // route root. Sibling `route=` children below are resolved exclusively —
    // the compiler renders only the one whose path matches the current URL.
    <div class="shell" route="/">
      <header class="topbar">
        <span class="brand">⚡ Memoized DOM</span>
        <Nav />
        <SessionBadge />
      </header>

      <main class="outlet">
        <Dashboard route="/" />
        <Stories   route="/stories" />
        <About     route="/about" />
      </main>
    </div>
  );
}
