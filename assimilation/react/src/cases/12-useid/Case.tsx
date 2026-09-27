import { useId } from 'react';

function Field({ label }: { label: string }) {
  const id = useId();
  return (
    <p>
      <label htmlFor={id}>{label}</label>{' '}
      <input id={id} data-testid={`input-${label}`} />
    </p>
  );
}

export function UseIdCase() {
  return (
    <section>
      <h2>useId — stable unique ids</h2>
      <Field label="Email" />
      <Field label="Password" />
      <p>
        <small>
          Click each label — focus must move to its own input (htmlFor/id
          pair). The two ids must differ.
        </small>
      </p>
    </section>
  );
}
