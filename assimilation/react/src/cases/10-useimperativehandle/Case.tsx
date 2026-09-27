import { forwardRef, useImperativeHandle, useRef } from 'react';

interface FieldApi {
  focus(): void;
  clear(): void;
}

const Field = forwardRef<FieldApi, { label: string }>(function Field(
  { label },
  ref,
) {
  const input = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        input.current?.focus();
      },
      clear() {
        if (input.current) input.current.value = '';
      },
    }),
    [],
  );
  return (
    <label>
      {label}: <input ref={input} />
    </label>
  );
});

export function UseImperativeHandleCase() {
  const api = useRef<FieldApi | null>(null);
  return (
    <section>
      <h2>useImperativeHandle — parent-driven actions</h2>
      <Field label="Name" ref={api} />
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
