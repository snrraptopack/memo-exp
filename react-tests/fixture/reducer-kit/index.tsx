import { useReducer } from 'react';

function observe<T>(name: string, value: T): T {
  console.log(name);
  return value;
}

function add(current: number, amount: number) {
  return current + amount;
}

export function Counter() {
  const [value, dispatch] = useReducer(
    observe('reducer', add),
    observe('initial argument', 2),
    observe('initializer', initial => initial * 2),
  );
  return <button onClick={() => dispatch(2)}>{value}</button>;
}
