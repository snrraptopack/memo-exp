import { Group } from '@memoized-dom/data';
import { route } from '@memoized-dom/router';
import { Board } from '../components/Board';
import { RowPending } from '../components/Feedback';

export function Progressive() {
  return <section class="page">
    <p class="eyebrow">Colorless / progressive</p>
    <h1>Static rows now. Data as it arrives.</h1>
    <p>The child Group overrides only pending. The error policy is inherited from App across files.</p>
    <Group pending={RowPending}>
      <Board mode="progressive" run={route.params.run ?? 'first'} />
    </Group>
    <p>Retry changes only the failed read; ready rows and the note input stay mounted.</p>
  </section>;
}
