let count = 0;
let again = 0;

export function Counter() {
  const inc = () => { count++; again++; };
  return (
    <div class="counter">
      <button onClick={inc}>increment</button>
      <span>{count}</span>
      <span>{again}</span>
    </div>
  );
}
