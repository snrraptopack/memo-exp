import { columns } from './state';
import { BoardHeader } from './components/BoardHeader.tsrx';
import { BoardColumn } from './components/BoardColumn.tsrx';

export function App() @{
  <main class="board-app">
    <style>
      .board-app {
        width: min(78rem, calc(100vw - 3rem));
        margin: 2.5rem auto;
        padding: 2rem;
        background: #0d1117;
        border: 1px solid #21262d;
        border-radius: 1.25rem;
        box-shadow: 0 2rem 4rem rgb(0 0 0 / 40%);
        display: flex;
        flex-direction: column;
        gap: 1.75rem;
      }
      .columns-layout {
        display: flex;
        gap: 1.25rem;
        overflow-x: auto;
        padding-bottom: 0.5rem;
      }
      @media (max-width: 54rem) {
        .columns-layout {
          flex-direction: column;
        }
      }
    </style>

    <BoardHeader />

    <div class="columns-layout">
      @for (const column of columns; key column.id) {
        <BoardColumn column={column} />
      }
    </div>
  </main>
}
