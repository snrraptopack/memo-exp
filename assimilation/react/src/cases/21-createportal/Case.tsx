import { useState } from 'react';
import { createPortal } from 'react-dom';

function PortalBadge() {
  const [count, setCount] = useState(0);
  const host = document.getElementById('portal-host');
  if (host === null) return null;
  return createPortal(
    <button onClick={() => setCount((c) => c + 1)}>
      portal badge — clicks: {count}
    </button>,
    host,
  );
}

export function CreatePortalCase() {
  return (
    <section>
      <h2>createPortal — render outside the root</h2>
      <p>
        The badge below is rendered by this component but lives in
        <code>#portal-host</code> — a sibling of <code>#root</code>, not a
        descendant. Inspect the DOM to see it.
      </p>
      <p>
        <small>
          It has its own state — the button counts clicks while mounted in
          the foreign container.
        </small>
      </p>
      <PortalBadge />
    </section>
  );
}
