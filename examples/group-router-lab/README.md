# Group + Router Lab

A small, split-file example of the implemented Group/router behavior. It uses
a deterministic Fetch-compatible transport, not a backend or a global fetch
patch. This is a client-rendered example, not an SSR/preload demonstration.

From the repository root, with the workspace packages built:

```powershell
bunx vite --config examples/group-router-lab/vite.config.ts
```

Open the root URL printed by Vite. Direct visits to the nested routes also work.

To run the real-browser smoke checks (requires installed Chrome/Chromium, or
`MMD_BROWSER_PATH`):

```powershell
node examples/group-router-lab/tests/browser.mjs
```

## What to try

- **Progressive rows:** headings and the input appear immediately. Each row
  owns a `$fetch` in `components/CardRow.tsx`; Group policy travels from App
  through the routed page and Board into those row reads. The page overrides
  only pending, preserving App's error policy. The retry row intentionally
  returns 503 once per fresh run. Retry only that read; existing input state
  and ready rows remain.
- **Atomic board:** `Board suspend` starts all consumed child requests, shows
  one pending arm, then publishes the board once. Its input is absent while
  pending and its focus ref runs after activation. Hide it before completion
  to cancel the staged requests and prevent stale DOM publication.
- **Prepared detail:** `$routed` waits 400ms for fast or 2400ms for slow before the destination
  component mounts. The old page and URL stay committed during preparation.
  Click another destination before it finishes to supersede that attempt.
  Group pre-entry shells/errors are **not implemented** and are not simulated.
  On a direct visit, client entry waits before mounting; there is no old page
  to retain. Vite's first-time module compilation adds development overhead;
  these timings describe the data delay, not the entire cold startup.
- **Route identity:** type a detail draft and switch between fast/slow detail;
  the changed path parameter creates a fresh input. Change the query instead
  to retain the route instance and its draft (entry preparation still reruns).
  The current tab is displayed, and both Notes and Overview links let you
  repeat the check. A hard refresh resets the draft: no storage is used.
- **Fresh runs:** the first/second run links change request identity and route
  parameters. Revisiting a resolved run can reuse cached results; reload the
  browser to reset the demo transport's first-attempt failures.
- **Scroll restoration:** scroll a page, navigate elsewhere, then use browser
  Back/Forward. Each history entry restores its own offset after its DOM is
  ready. Clicking a link creates a new entry and starts at the top. Use a short
  browser window if a page does not have enough content to scroll.
  Chrome can show its native loading indicator while atomic publication is
  pending; this is same-document navigation, not a full page reload.

## File responsibilities

`App.tsx` is the persistent shell and outer Group policy. `pages/DemoRoutes.tsx`
owns the route subtree. Each page demonstrates one reveal strategy.
`components/Board.tsx` composes the input and keyed rows; `CardRow.tsx` owns
the resource; `Feedback.tsx` defines presentation. `data/` contains types,
fixtures, cancelable transport delays, and universal entry preparation.

Route-only page modules are eligible for the compiler's lazy imports. In a
production build, their code is split rather than eagerly bundled into the
entry. No authored route IDs, transfer keys, or manual preload links are needed.
