<!--
  @file vue.vue
  Benchmarks a normal Vue SFC with proxy state and keyed component rows.
-->
<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef } from 'vue';
import type { BenchMode, BenchScenario } from '../contract';
import {
  makeSnapshot,
  mutatePlain,
  remaining,
  type Snapshot,
} from '../model';
import VueRow from './vue-row.vue';

const mode = ref<BenchMode>('reactive');
const reactiveSnapshot = shallowRef(reactive(makeSnapshot(0)));
let forcedSnapshot = makeSnapshot(0);
const forcedRevision = ref(0);

const visible = computed(() => {
  if (mode.value === 'forced') void forcedRevision.value;
  return mode.value === 'forced' ? forcedSnapshot : reactiveSnapshot.value;
});

const remainingCount = computed(() => remaining(visible.value));

function mutateReactive(scenario: BenchScenario): void {
  mutatePlain(reactiveSnapshot.value as Snapshot, scenario);
}

async function reset(count: number, nextMode: BenchMode): Promise<void> {
  mode.value = nextMode;
  forcedSnapshot = makeSnapshot(count);
  reactiveSnapshot.value = reactive(makeSnapshot(count));
  forcedRevision.value++;
  await nextTick();
}

async function run(scenario: BenchScenario): Promise<void> {
  if (mode.value === 'forced') {
    mutatePlain(forcedSnapshot, scenario);
    forcedRevision.value++;
  } else {
    mutateReactive(scenario);
  }
  await nextTick();
}

defineExpose({ reset, run });
</script>

<template>
  <span>{{ visible.revision ? '' : '' }}</span>
  <ul>
    <VueRow
      v-for="todo in visible.todos"
      :key="todo.id"
      :todo="todo"
      :forced-revision="mode === 'forced' ? forcedRevision : 0"
    />
  </ul>
  <strong id="remaining">{{ remainingCount }}</strong>
</template>
