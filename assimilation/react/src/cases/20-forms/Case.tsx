import { useActionState, useOptimistic, useRef } from 'react';
import { useFormStatus } from 'react-dom';

interface Message {
  text: string;
  pending?: boolean;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'sending…' : 'send'}
    </button>
  );
}

export function FormsCase() {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [messages, sendMessage] = useActionState<Message[], FormData>(
    async (prev, fd) => {
      const text = String(fd.get('msg') ?? '');
      await delay(1200);
      return [...prev, { text }];
    },
    [],
  );
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (cur: Message[], text: string) => [...cur, { text, pending: true }],
  );
  return (
    <section>
      <h2>React 19 forms — action state + optimistic</h2>
      <ul>
        {optimistic.map((m, i) => (
          <li key={i} data-pending={m.pending ?? false}>
            {m.text}
            {m.pending ? ' (sending)' : ''}
          </li>
        ))}
      </ul>
      <form
        ref={formRef}
        action={async (fd) => {
          addOptimistic(String(fd.get('msg') ?? ''));
          await sendMessage(fd);
          formRef.current?.reset();
        }}
      >
        <input name="msg" placeholder="message" required /> <SubmitButton />
      </form>
      <p>
        <small>
          Submit: the row appears instantly with "(sending)" (optimistic),
          the button flips to "sending…" (useFormStatus), then ~1.2s later
          the action commits and the row settles.
        </small>
      </p>
    </section>
  );
}
