import { addTodo, renameFirst, setFilter, toggleFirst } from './actions';
import { completed, remaining, total } from './derived';
import { board } from './state';

export function TodoBoard() {
  return <section><button onClick={() => addTodo('write paper')}>add</button><button onClick={() => toggleFirst()}>toggle</button><button onClick={() => renameFirst('revise paper')}>rename</button><button onClick={() => setFilter('open')}>open</button><output>{board.filter}:{total}:{completed}:{remaining}</output></section>;
}
