export type ApplicationScenario =
  | 'load'
  | 'inspect'
  | 'triage'
  | 'search'
  | 'organize'
  | 'navigate'
  | 'bulk-update';

export interface ApplicationValidation {
  activity: number;
  digest: string;
  open: number;
  reportDigest: string;
  resolved: number;
  selected: number;
  total: number;
  view: string;
  visible: number;
}

export interface ApplicationBench {
  id: string;
  label: string;
  version: string;
  reset(
    count: number,
    scenario: ApplicationScenario,
  ): void | Promise<void>;
  run(scenario: ApplicationScenario): void | Promise<void>;
  validate(): ApplicationValidation;
}

declare global {
  interface Window {
    __applicationBench: ApplicationBench;
  }
}
