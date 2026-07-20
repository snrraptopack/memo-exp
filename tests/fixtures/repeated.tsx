// repeated.tsx — same child mounted twice; instances must get distinct
// entity ids and the table must cover both.
let label = 'hello';

function Tag() {
  return <span class="tag">{label}</span>;
}

export function App() {
  const swap = () => {
    label = 'world';
  };
  return (
    <div>
      <Tag />
      <Tag />
      <button onClick={swap}>swap</button>
    </div>
  );
}
