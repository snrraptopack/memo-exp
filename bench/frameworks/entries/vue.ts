/**
 * @file vue.ts
 * Mounts the compiled Vue SFC and publishes the common benchmark contract.
 */
import { createApp } from 'vue';
import type { BenchMode, BenchScenario } from '../contract';
import VueApp from '../adapters/vue.vue';

declare const __FRAMEWORK_VERSION__: string;

interface VueControls {
  reset(count: number, mode: BenchMode): Promise<void>;
  run(scenario: BenchScenario): Promise<void>;
}

const target = document.querySelector('#app') as HTMLElement;
const controls = createApp(VueApp).mount(target) as unknown as VueControls;

window.__frameworkBench = {
  id: 'vue',
  label: 'Vue',
  version: __FRAMEWORK_VERSION__,
  reset: (count, mode) => controls.reset(count, mode),
  run: (scenario) => controls.run(scenario),
  validate() {
    return {
      rows: target.querySelectorAll('li').length,
      firstTitle: target.querySelector('li')?.textContent?.trim() ?? '',
      remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
    };
  },
};

