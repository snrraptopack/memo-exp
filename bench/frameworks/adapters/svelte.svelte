<!--
  @file svelte.svelte
  Benchmarks a normal Svelte 5 component using runes and keyed each blocks.
-->
<script lang="ts">
  import type { BenchMode, BenchScenario } from '../contract';
  import { makeSnapshot, mutatePlain, remaining } from '../model';

  let mode = $state<BenchMode>('reactive');
  let reactiveSnapshot = $state(makeSnapshot(0));
  let forcedSnapshot = $state.raw(makeSnapshot(0));
  let forcedRevision = $state(0);

  const visible = $derived.by(() => {
    if (mode === 'forced') void forcedRevision;
    return mode === 'forced' ? forcedSnapshot : reactiveSnapshot;
  });
  const remainingCount = $derived(remaining(visible));

  export function reset(count: number, nextMode: BenchMode): void {
    mode = nextMode;
    reactiveSnapshot = makeSnapshot(count);
    forcedSnapshot = makeSnapshot(count);
    forcedRevision++;
  }

  export function run(scenario: BenchScenario): void {
    if (mode === 'forced') {
      mutatePlain(forcedSnapshot, scenario);
      forcedSnapshot = { ...forcedSnapshot };
      forcedRevision++;
    } else {
      mutatePlain(reactiveSnapshot, scenario);
    }
  }
</script>

<span>{visible.revision ? '' : ''}</span>
<ul>
  {#each visible.todos as todo (todo.id)}
    <li class:completed={todo.completed} data-id={todo.id}>
      {forcedRevision && mode === 'forced' ? todo.title : todo.title}
    </li>
  {/each}
</ul>
<strong id="remaining">{remainingCount}</strong>
