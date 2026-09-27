import { useEffect, useState } from 'react';

export function UseEffectTitle() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    document.title = unread === 0 ? 'Chat' : `Chat (${unread})`;
  }, [unread]);

  return (
    <section>
      <h2>useEffect → document.title</h2>
      <p>
        unread: <span data-testid="unread">{unread}</span>
      </p>
      <button onClick={() => setUnread((u) => u + 1)}>message arrives</button>
      <button onClick={() => setUnread(0)}>mark read</button>
      <p>
        <small>watch the browser tab title</small>
      </p>
    </section>
  );
}
