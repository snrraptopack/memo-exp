let nextFieldId = 0;

function allocFieldId() {
  nextFieldId++;
  return `field-${nextFieldId}`;
}

function Field({ label }: { label: string }) {
  let id = '';
  id = allocFieldId();
  return (
    <p>
      <label for={id}>{label}</label>{' '}
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
          Click each label — focus must move to its own input (for/id
          pair). The two ids must differ.
        </small>
      </p>
    </section>
  );
}
