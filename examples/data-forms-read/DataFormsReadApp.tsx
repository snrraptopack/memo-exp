import { $forms, $read, $track, Group, type StandardSchemaV1 } from '@memoized-dom/data';

interface Message {
  id: string;
  text: string;
  pending?: boolean;
}

interface MessageFields {
  message: string;
}

let added: Message[] = [];

const messageSchema: StandardSchemaV1<unknown, MessageFields> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate(value) {
      const message = (value as { message?: unknown }).message;
      return typeof message === 'string' && message.trim()
        ? { value: { message: message.trim() } }
        : { issues: [{ path: ['message'], message: 'Enter a message.' }] };
    },
  },
};

function loadMessages(): Promise<Message[]> {
  return new Promise(resolve => {
    setTimeout(() => resolve([{ id: 'welcome', text: 'Welcome' }]), 250);
  });
}

async function saveMessage(text: string): Promise<Message> {
  // Replace this function with a server function or an HTTP request.
  await new Promise(resolve => setTimeout(resolve, text.length % 3 * 150));
  if (text.toLowerCase() === 'fail') throw new Error('The message was rejected.');
  return { id: crypto.randomUUID(), text };
}

function LoadingMessages() {
  return <p>Loading messages…</p>;
}

export function DataFormsReadApp() {
  const initial = $read(loadMessages());
  const load = $track(initial);
  let total = added.length;

  const form = $forms({
    schema: messageSchema,
    action(fields) {
      // The form owns the operation, even though saveMessage returns a promise.
      const execution = $track(form);
      const temporary: Message = {
        id: execution.id,
        text: fields.message,
        pending: true,
      };
      added.push(temporary);

      execution.onSuccess(saved => {
        const index = added.indexOf(temporary);
        if (index !== -1) added.splice(index, 1, saved);
      });
      execution.onError(() => {
        const index = added.indexOf(temporary);
        if (index !== -1) added.splice(index, 1);
      });

      return saveMessage(fields.message);
    },
  });

  return (
    <section>
      <h2>New messages ({total})</h2>
      <button type="button" onClick={() => load.refresh()}>Reload initial messages</button>
      {load.refreshing && <span role="status"> Refreshing...</span>}
      <Group pending={LoadingMessages}>
        <ul>
          {initial.map(message => <li key={message.id}>{message.text}</li>)}
        </ul>
      </Group>
      <ul>
        {added.map(message => (
          <li key={message.id}>
            {message.text}{message.pending ? ' (sending)' : ''}
          </li>
        ))}
      </ul>
      <form onSubmit={form.submit}>
        <input name="message" aria-label="Message" />
        <button type="submit">Send</button>
        {form.pending && <span role="status"> Sending...</span>}
        {form.errors.length > 0 && <p role="alert">{form.errors[0]?.message}</p>}
      </form>
    </section>
  );
}
