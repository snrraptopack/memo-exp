import { $forms } from '@memoized-dom/data';
import { optimistic } from '@memoized-dom/utils';

interface Message {
  id: string;
  text: string;
  pending?: boolean;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let nextServerId = 1;

async function postMessage(text: string): Promise<Message> {
  await delay(1200);
  return { id: `srv-${nextServerId++}`, text };
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'sending…' : 'send'}
    </button>
  );
}

export function FormsCase() {
  const formEl = { current: null as HTMLFormElement | null };
  let messages: Message[] = [];

  const sendMessage = optimistic({
    action: (text: string) => postMessage(text),
    apply(text, id) {
      messages.push({ id, text, pending: true });
      return () => {
        const index = messages.findIndex((m) => m.id === id);
        if (index !== -1) messages.splice(index, 1);
      };
    },
    reconcile(saved, _text, id) {
      const index = messages.findIndex((m) => m.id === id);
      if (index !== -1) messages.splice(index, 1, saved);
      formEl.current?.reset();
    },
  });

  const form = $forms((fields: FormData) =>
    sendMessage(String(fields.get('msg') ?? '')),
  );

  return (
    <section>
      <h2>React 19 forms — action state + optimistic</h2>
      <ul>
        {messages.map((m) => (
          <li key={m.id} data-pending={m.pending ?? false}>
            {m.text}
            {m.pending ? ' (sending)' : ''}
          </li>
        ))}
      </ul>
      <form ref={formEl} onSubmit={form.submit}>
        <input name="msg" placeholder="message" required />{' '}
        <SubmitButton pending={form.pending} />
      </form>
      {form.errors.map((e) => (
        <p>{e.message}</p>
      ))}
      <p>
        <small>
          {form.hasResult
            ? `last delivered: ${form.result?.text} (${form.result?.id})`
            : 'nothing delivered yet'}
        </small>
      </p>
      <p>
        <small>
          `$forms` owns submit/pending/errors/result; `optimistic` owns the
          instant row plus per-operation rollback and reconcile (its plain
          promise action is wrapped in `$read` internally).
        </small>
      </p>
    </section>
  );
}
