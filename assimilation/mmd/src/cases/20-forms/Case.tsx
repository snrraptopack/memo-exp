interface Message {
  text: string;
  pending?: boolean;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'sending…' : 'send'}
    </button>
  );
}

export function FormsCase() {
  let pending = false;
  let messages: Message[] = [];
  return (
    <section>
      <h2>React 19 forms — action state + optimistic</h2>
      <ul>
        {messages.map((m, i) => (
          <li data-index={i} data-pending={m.pending ?? false}>
            {m.text}
            {m.pending ? ' (sending)' : ''}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const text = String(fd.get('msg') ?? '');
          const item = { text, pending: true };
          messages = [...messages, item];
          pending = true;
          e.currentTarget.reset();
          await delay(1200);
          messages = messages.map((m) =>
            m === item ? { text } : m,
          );
          pending = false;
        }}
      >
        <input name="msg" placeholder="message" required />{' '}
        <SubmitButton pending={pending} />
      </form>
      <p>
        <small>
          "Optimistic" is a plain write — the row pushes instantly, its
          `pending` field flips when the awaited commit resolves. No action
          channel, no form context.
        </small>
      </p>
    </section>
  );
}
