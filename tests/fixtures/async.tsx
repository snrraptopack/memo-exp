// Fixture: async commit attribution.
let count = 0;

export function AsyncCounter() {
  const incLater = async () => {
    await Promise.resolve();
    count++;
  };
  const incTimer = () => {
    setTimeout(() => {
      count = 10;
    }, 0);
  };
  return (
    <div>
      <button onClick={incLater}>async</button>
      <button onClick={incTimer}>timer</button>
      <span>{count}</span>
    </div>
  );
}
