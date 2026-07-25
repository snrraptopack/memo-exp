/**
 * @file svelte.ts
 * Mounts the compiled Svelte component and flushes each measured update.
 */
import { flushSync, mount, tick } from 'svelte';
import type { BenchMode, BenchScenario } from '../contract';
import SvelteApp from '../adapters/svelte.svelte';

declare const __FRAMEWORK_VERSION__: string;

interface SvelteControls {
  reset(count: number, mode: BenchMode): void;
  run(scenario: BenchScenario): void;
}

const target = document.querySelector('#app') as HTMLElement;
const controls = mount(SvelteApp, { target }) as SvelteControls;
let currentMode: BenchMode = 'reactive';

window.__frameworkBench = {
  id: 'svelte',
  label: 'Svelte',
  version: __FRAMEWORK_VERSION__,
  reset(count, mode) {
    currentMode = mode;
    flushSync(() => controls.reset(count, mode));
  },
  run(scenario) {
    if (currentMode === 'forced') {
      flushSync(() => controls.run(scenario));
      return;
    }
    controls.run(scenario);
    return tick();
  },
  validate() {
    return {
      rows: target.querySelectorAll('li').length,
      firstTitle: target.querySelector('li')?.textContent?.trim() ?? '',
      order: Array.from(target.querySelectorAll('li'), (row) => row.dataset.id).join(','),
      remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
      state: Array.from(target.querySelectorAll('li'), (row) => `${row.dataset.id}:${row.classList.contains('completed') ? 1 : 0}:${row.textContent?.trim() ?? ''}`).join('|'),
    };
  },
};
