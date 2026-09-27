# 21-createportal (MMD equivalent — manual effect)

## What the twin does

```tsx
effect(() => {
  const badge = document.createElement('button');
  badge.textContent = 'portal badge — clicks: 0';
  badge.addEventListener('click', () => { count++; badge.textContent = …; });
  host.appendChild(badge);
  return () => badge.remove();   // teardown removes the node
});
```

An `effect` escapes into the foreign container imperatively and cleans it
up on unmount. The counter still ticks — but the badge's text is updated
by **manual DOM writes**, not JSX.

## The boundary

MMD components own DOM strictly under their own parent — reactive JSX
cannot mount into a foreign container, so `createPortal(<reactive jsx/>)`
has no lowering. What IS expressible:

- Static/imperative content in a foreign node via `effect` + cleanup
  (this file).

What is NOT:

- Reactive MMD JSX/state inside the foreign container — that would need a
  real portal primitive that mounts MMD-owned nodes outside the parent
  chain while keeping instance ownership.

## Same checklist as the React version

1. Badge appears in `#portal-host` (inspect — same container both apps).
2. Counts clicks.
3. Unmount removes the node.

## Notes / divergences

- React's portal content is fully managed reactive JSX; MMD's is manual.
  Divergence documented — `createPortal` lowering needs a portal primitive.

_(fill in when verified)_
