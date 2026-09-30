import { afterEach, expect, it, vi } from 'vitest';
import { measureInPage, type MeasureConfig } from '../bench/frameworks/measure';
import { makeSnapshot, mutatePlain, remaining } from '../bench/frameworks/model';
import type { FrameworkBench } from '../bench/frameworks/contract';

const config: MeasureConfig = {
  counts: [3], iterations: { 3: 2 }, modes: ['reactive'], samples: 1,
  scenarios: ['rename'], warmup: 0,
};
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  delete (window as Partial<Window>).__frameworkBench;
});

function adapter(staleFirstOperation = false) {
  let snapshot = makeSnapshot(3);
  const validated: number[] = [];
  const bench: FrameworkBench = {
    id: 'test', label: 'test', version: 'test',
    reset(count) { snapshot = makeSnapshot(count); },
    async run(scenario) {
      await Promise.resolve();
      mutatePlain(snapshot, scenario);
    },
    validate() {
      validated.push(snapshot.sequence);
      return {
        rows: snapshot.todos.length, firstTitle: snapshot.todos[0]!.title,
        order: snapshot.todos.map(todo => todo.id).join(','),
        remaining: remaining(snapshot),
        state: staleFirstOperation && snapshot.sequence === 1 ? 'stale DOM' :
          snapshot.todos.map(todo => `${todo.id}:${todo.completed ? 1 : 0}:${todo.title}`).join('|'),
      };
    },
  };
  window.__frameworkBench = bench;
  document.body.innerHTML = '<main id="app"></main>';
  return { bench, validated };
}

it('rejects a stale intermediate DOM even when the batch endpoint would be correct', async () => {
  const app = adapter(true);
  await expect(measureInPage(config)).rejects.toThrow('after operation 1');
  expect(app.validated).toEqual([0, 1]);
});

it('awaits every completion signal and keeps per-operation inspection outside timing', async () => {
  const app = adapter();
  let timed = false;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    timed = !timed;
    return timed ? 0 : 1;
  });
  const validate = app.bench.validate;
  app.bench.validate = () => {
    expect(timed).toBe(false);
    return validate();
  };
  const results = await measureInPage(config);
  expect(app.validated).toEqual([0, 1, 2, 2]);
  expect(results[0]!.nsPerOp).toBe(500_000);
});
