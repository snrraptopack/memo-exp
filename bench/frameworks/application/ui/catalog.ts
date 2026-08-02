import type { ApplicationScenario } from '../contract';

export interface FrameworkOption {
  id: string;
  label: string;
}

export const frameworks: readonly FrameworkOption[] = [
  { id: 'memoized-dom', label: 'memoized-dom' },
  { id: 'solid', label: 'Solid' },
  { id: 'vanilla', label: 'Vanilla DOM' },
  { id: 'react', label: 'React' },
  { id: 'preact', label: 'Preact' },
  { id: 'vue', label: 'Vue' },
  { id: 'svelte', label: 'Svelte' },
];

export const scenarios: readonly {
  id: ApplicationScenario;
  label: string;
}[] = [
  { id: 'load', label: 'Load tickets' },
  { id: 'inspect', label: 'Inspect ticket' },
  { id: 'triage', label: 'Triage ticket' },
  { id: 'search', label: 'Search tickets' },
  { id: 'organize', label: 'Organize tickets' },
  { id: 'navigate', label: 'Navigate to report' },
  { id: 'bulk-update', label: 'Bulk update' },
];
