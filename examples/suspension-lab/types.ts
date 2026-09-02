export interface Profile {
  name: string;
  role: string;
  region: string;
  initials: string;
}

export interface Metrics {
  availability: string;
  requests: string;
  latency: string;
}

export interface Activity {
  latestDeploy: string;
  environment: string;
  status: string;
}

export type LabScenario =
  | 'colorless-tsx'
  | 'suspended-tsx'
  | 'suspended-tsrx'
  | 'colorless-tsrx';
