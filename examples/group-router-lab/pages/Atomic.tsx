import { Group } from '@memoized-dom/data';
import { route } from '@memoized-dom/router';
import { Board } from '../components/Board';
import { AtomicPending } from '../components/Feedback';

export function Atomic() {
  let visible = true;

  return <section class="page">
    <p class="eyebrow">Suspend / atomic first mount</p>
    <h1>Discover the whole board. Reveal it once.</h1>
    <p>The requests belong to CardRow, two files below this boundary. The input ref runs only after publication.</p>
    <button id="toggle-board"
      onClick={() => { visible = !visible; }}>
      Hide / show the board
    </button>

    <Group pending={AtomicPending}>
      {visible ?
        <Board
          suspend
          mode="atomic"
          run={route.params.run ?? 'first'}
        /> : <p data-abandoned>Board removed. Pending requests, if any, were canceled.</p>}
    </Group>

    <p>Remove the board while it is pending, or navigate away: late responses must not insert old rows.</p>
  </section>;
}
