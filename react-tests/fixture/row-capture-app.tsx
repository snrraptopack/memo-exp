import { CapturedRows } from 'row-capture-kit';

export function App() {
  let className = 'row';
  return <main>
    <button onClick={() => { className = className === 'row' ? 'selected' : 'row'; }}>toggle</button>
    <CapturedRows className={className}><span>A</span></CapturedRows>
  </main>;
}
