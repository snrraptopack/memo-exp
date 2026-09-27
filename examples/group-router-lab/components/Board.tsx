import { cards, type RevealMode } from '../data/cards';
import { CardRow } from './CardRow';

/** No Group here: policy passes through this component into row-owned resources. */
export function Board({ mode, run }: { mode: RevealMode; run: string }) {
  return <section class="board" data-board={mode}>
    <label class="note-field">
      Board note
      <input placeholder="Write after the board appears" ref={(node: HTMLInputElement) => node.focus()} />
    </label>
    <ul>{cards.map(item => <CardRow key={item.id} item={item} mode={mode} run={run} />)}</ul>
  </section>;
}
