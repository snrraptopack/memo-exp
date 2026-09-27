export function UseEffectTitle() {
  let unread = 0;

  effect(() => {
    document.title = unread === 0 ? 'Chat' : `Chat (${unread})`;
  });

  return (
    <section>
      <h2>useEffect → document.title</h2>
      <p>
        unread: <span data-testid="unread">{unread}</span>
      </p>
      <button onClick={() => unread++}>message arrives</button>
      <button onClick={() => (unread = 0)}>mark read</button>
      <p>
        <small>watch the browser tab title</small>
      </p>
    </section>
  );
}
