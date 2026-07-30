import type {
  ApplicationMeasurement,
  ApplicationMeasureConfig,
} from './measure';

export interface ApplicationFrameworkResult {
  bundle: {
    gzipBytes: number;
    rawBytes: number;
  };
  id: string;
  label: string;
  measurements: ApplicationMeasurement[];
  version: string;
}

export interface ApplicationRun {
  browser: string;
  config: ApplicationMeasureConfig;
  date: string;
  note: string;
  platform: string;
  results: ApplicationFrameworkResult[];
}
