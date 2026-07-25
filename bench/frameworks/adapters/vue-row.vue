<!--
  @file vue-row.vue
  Keeps row dependencies inside a normal Vue child component.
-->
<script setup lang="ts">
import type { Todo } from '../model';

defineProps<{
  todo: Todo;
  forcedRevision: number;
}>();
</script>

<template>
  <li :class="{ completed: todo.completed }">
    {{ forcedRevision ? todo.title : todo.title }}
  </li>
</template>
