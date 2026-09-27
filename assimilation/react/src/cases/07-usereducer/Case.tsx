import { useReducer } from 'react';

function add(current: number, amount: number) {
  return current + amount;
}

export function UseReducerInit() {
  const [value, dispatch] = useReducer(add, 2, (initial) => initial * 2);

  return (
    <section>
      <h2>useReducer — with initializer</h2>
      <p>
        value: <span data-testid="value">{value}</span>
      </p>
      <button onClick={() => dispatch(2)}>+2</button>
      <button onClick={() => dispatch(-1)}>-1</button>
      <button onClick={() => dispatch(-value)}>zero</button>
    </section>
  );
}
