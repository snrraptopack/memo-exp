import { Suspense, use, useActionState } from 'react';

function loadMessage(key: string): Promise<{ text: string }> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ text: `msg-${key}` }), 20);
  });
}

function Panel({ k }: { k: string }) {
  const msg = use(loadMessage(k));
  return <p class="panel">{msg.text}</p>;
}

export function Feed() {
  return <section>
    <Suspense fallback={<b class="ph">loading</b>}>
      <Panel k="a" />
    </Suspense>
    <Suspense fallback={<b class="ph2">waiting</b>}>
      <Panel k="b" />
    </Suspense>
  </section>;
}

export function Tally() {
  const [state, dispatch, pending] = useActionState(
    async (prev: number, fields: FormData) => prev + Number(fields.get('n') ?? 0),
    0,
  );
  return <section>
    <form action={dispatch}>
      <input name="n" value="5" />
      <button id="submit" type="submit">add</button>
    </form>
    <button id="manual" onClick={() => {
      const data = new FormData();
      data.set('n', '2');
      dispatch(data);
    }}>manual</button>
    <output id="state">{state}</output>
    <output id="pending">{pending ? 'pending' : 'idle'}</output>
  </section>;
}

export function ButtonAction() {
  const [total, dispatch] = useActionState(
    async (previous: number, fields: FormData) =>
      previous + Number(fields.get('amount') ?? 0),
    0,
  );
  return <section>
    <form>
      <input name="amount" value="7" />
      <button id="button-action" type="submit" formAction={dispatch}>add</button>
    </form>
    <output id="button-total">{total}</output>
  </section>;
}
