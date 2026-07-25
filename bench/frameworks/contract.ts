/**
 * @file contract.ts
 * Defines the browser-side contract shared by every framework adapter.
 */
export type BenchMode = 'reactive' | 'forced';
export type BenchScenario = 'no-change' | 'rename' | 'toggle' | 'move';

export interface ValidationResult {
  rows: number;
  firstTitle: string;
  remaining: number;
}

export interface FrameworkBench {
  id: string;
  label: string;
  version: string;
  reset(count: number, mode: BenchMode): void | Promise<void>;
  run(scenario: BenchScenario): void | Promise<void>;
  validate(): ValidationResult;
}

declare global {
  interface Window {
    __frameworkBench: FrameworkBench;
  }
}

