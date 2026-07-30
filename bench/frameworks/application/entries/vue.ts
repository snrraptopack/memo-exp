import { createApp, nextTick } from 'vue';
import type { ApplicationScenario } from '../contract';
import { readApplicationDom } from '../dom-validation';
import { dispatchApplicationScenario } from '../events';
import VueApplication from '../adapters/vue.vue';

declare const __FRAMEWORK_VERSION__: string;

interface VueControls {
  reset(count: number, scenario: ApplicationScenario): void;
  run(scenario: ApplicationScenario): void;
}

const target = document.querySelector('#app') as HTMLElement;
const controls = createApp(VueApplication).mount(
  target,
) as unknown as VueControls;

window.__applicationBench = {
  id: 'vue',
  label: 'Vue',
  version: __FRAMEWORK_VERSION__,
  async reset(count, scenario) {
    controls.reset(count, scenario);
    await nextTick();
  },
  async run(scenario) {
    dispatchApplicationScenario(target, scenario);
    await nextTick();
  },
  validate: () => readApplicationDom(target),
};
