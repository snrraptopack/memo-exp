import { mount, tick } from 'svelte';
import type { ApplicationScenario } from '../contract';
import { readApplicationDom } from '../dom-validation';
import { dispatchApplicationScenario } from '../events';
import SvelteApplication from '../adapters/svelte.svelte';

declare const __FRAMEWORK_VERSION__: string;

interface SvelteControls {
  reset(count: number, scenario: ApplicationScenario): void;
  run(scenario: ApplicationScenario): void;
}

const target = document.querySelector('#app') as HTMLElement;
const controls = mount(SvelteApplication, { target }) as SvelteControls;

window.__applicationBench = {
  id: 'svelte',
  label: 'Svelte',
  version: __FRAMEWORK_VERSION__,
  async reset(count, scenario) {
    controls.reset(count, scenario);
    await tick();
  },
  async run(scenario) {
    dispatchApplicationScenario(target, scenario);
    await tick();
  },
  validate: () => readApplicationDom(target),
};
