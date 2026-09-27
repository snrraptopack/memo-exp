# useeffect-title

Exercises `useEffect` with a dependency array: the effect re-runs each time
`unread` changes and pushes state outward to `document.title`.

## What to verify

1. On mount, tab title is `Chat` (effect runs once after first render).
2. **message arrives** → `unread` increments and the title becomes
   `Chat (N)` — one title update per click.
3. **mark read** → title returns to `Chat`.
4. Navigate away (back to index) — the React effect stops firing; navigate
   back — it resumes. (MMD equivalent: effect teardown/recreation.)

## Expected React semantics being captured

- `useEffect(fn, [dep])` → MMD `effect(() => { ... })` where the dep array is
  replaced by the compiler's read tracking — the callback re-runs whenever
  any reactive value it reads (`unread`) changes.
- Effect runs after the DOM settles, not during render.
