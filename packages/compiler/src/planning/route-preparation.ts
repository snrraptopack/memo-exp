/** Source facts consumed by project linking and target-specific route emission. */
export interface CompilerRoutedPreparation {
  readonly id: string;
  readonly moduleId: string;
  readonly component: string;
  readonly binding: string;
  readonly contextFields: readonly string[];
  readonly server: boolean;
  readonly line?: number;
  readonly column?: number;
}
