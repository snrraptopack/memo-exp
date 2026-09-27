interface FieldApi {
  focus(): void;
  clear(): void;
}

function Field({
  label,
  api,
}: {
  label: string;
  api: { current: FieldApi | null };
}) {
  let input: HTMLInputElement | undefined;
  effect(() => {
    api.current = {
      focus() {
        input?.focus();
      },
      clear() {
        if (input) input.value = '';
      },
    };
    return () => {
      api.current = null;
    };
  });
  return (
    <label>
      {label}: <input ref={input} />
    </label>
  );
}

export function UseImperativeHandleCase() {
  const api: { current: FieldApi | null } = { current: null };
  return (
    <section>
      <h2>useImperativeHandle — parent-driven actions</h2>
      <Field label="Name" api={api} />
      <button onClick={() => api.current?.focus()}>focus field</button>
      <button onClick={() => api.current?.clear()}>clear field</button>
      <p>
        <small>
          Type in the field, then click "clear field" — the parent reached
          into the child through the imperative handle.
        </small>
      </p>
    </section>
  );
}
