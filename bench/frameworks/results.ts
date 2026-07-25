/**
 * @file results.ts
 * Defines the persisted result schema for complete framework benchmark runs.
 */
import type { BrowserMeasurement, MeasureConfig } from './measure';

export interface BundleSize {
  gzipBytes: number;
  rawBytes: number;
}

export interface FrameworkResult {
  bundle: BundleSize;
  id: string;
  label: string;
  measurements: BrowserMeasurement[];
  version: string;
}

export interface FrameworkRun {
  browser: string;
  config: MeasureConfig;
  date: string;
  note: string;
  platform: string;
  results: FrameworkResult[];
}

