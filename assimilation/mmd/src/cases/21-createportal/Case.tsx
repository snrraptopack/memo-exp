export function CreatePortalCase() {
  let count = 0;
  effect(() => {
    const host = document.getElementById('portal-host');
    if (host === null) return;
    const badge = document.createElement('button');
    badge.textContent = 'portal badge — clicks: 0';
    badge.addEventListener('click', () => {
      count++;
      badge.textContent = `portal badge — clicks: ${count}`;
    });
    host.appendChild(badge);
    return () => badge.remove();
  });
  return (
    <section>
      <h2>createPortal — render outside the root</h2>
      <p>
        The badge below is created by an <code>effect</code> appending into
        <code>#portal-host</code> — imperative escape, not JSX. Inspect the
        DOM to see it there.
      </p>
      <p>
        <small>
          Manual textContent updates — MMD-owned JSX can't live in a foreign
          container, so reactive portal content isn't expressible this way.
        </small>
      </p>
    </section>
  );
}
