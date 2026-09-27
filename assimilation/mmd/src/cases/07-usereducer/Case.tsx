function add(current: number, amount: number) {
  return current + amount;
}

function Lowered() {
  const initialArg = 2;
  const init = (initial: number) => initial * 2;
  let value = init(initialArg);
  const dispatch = (next: number) => {
    value = add(value, next);
  };
  return (
    <section>
      <h3>lowered — what compiled React emits</h3>
      <p>
        value: <span data-testid="value-lowered">{value}</span>
      </p>
      <button onClick={() => dispatch(2)}>+2</button>
      <button onClick={() => dispatch(-1)}>-1</button>
      <button onClick={() => dispatch(-value)}>zero</button>
    </section>
  );
}

function Idiomatic() {
  let value = 4;
  return (
    <section>
      <h3>idiomatic — how a native MMD author writes it</h3>
      <p>
        value: <span data-testid="value-idiomatic">{value}</span>
      </p>
      <button onClick={() => (value = add(value, 2))}>+2</button>
      <button onClick={() => (value = add(value, -1))}>-1</button>
      <button onClick={() => (value = 0)}>zero</button>
    </section>
  );
}

export function UseReducerInit() {
  return (
    <>
      <h2>useReducer — lowered vs idiomatic</h2>
      <Lowered />
      <Idiomatic />
    </>
  );
}
