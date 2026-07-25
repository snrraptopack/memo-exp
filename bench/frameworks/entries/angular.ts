/**
 * @file angular.ts
 * Bootstraps the AOT-compiled Angular adapter with zoneless scheduling.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AngularApp } from '../adapters/angular';

declare const __FRAMEWORK_VERSION__: string;

const target = document.querySelector('#app') as HTMLElement;

void bootstrapApplication(AngularApp, {
  providers: [provideZonelessChangeDetection()],
}).then((application) => {
  const component = application.components[0]!.instance;
  window.__frameworkBench = {
    id: 'angular',
    label: 'Angular Signals',
    version: __FRAMEWORK_VERSION__,
    async reset(count, mode) {
      component.reset(count, mode);
      await application.whenStable();
    },
    async run(scenario) {
      component.run(scenario);
      await application.whenStable();
    },
    validate() {
      return {
        rows: target.querySelectorAll('li').length,
        firstTitle: target.querySelector('li')?.textContent?.trim() ?? '',
        remaining: Number(target.querySelector('#remaining')?.textContent ?? -1),
      };
    },
  };
});

