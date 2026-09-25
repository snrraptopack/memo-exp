import { useReducer } from 'react';

function add(current: number, amount: number) {
  return current + amount;
}

export function Counter() {
  const [value, dispatch] = useReducer(add, 2, initial => initial * 2);
  return <button onClick={() => dispatch(2)}>{value}</button>;
}
