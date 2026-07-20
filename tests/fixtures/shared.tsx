// shared.tsx — two siblings sharing module state; the write must route
// to Badge only, never to App or Editor.
let name = 'Ada';

function Badge() {
  return <span class="badge">{name}</span>;
}

function Editor() {
  const rename = () => {
    name = 'Grace';
  };
  return <button onClick={rename}>rename</button>;
}

export function App() {
  return (
    <div>
      <Badge />
      <Editor />
    </div>
  );
}
