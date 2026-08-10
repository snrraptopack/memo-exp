export type AnalysisTier =
  | 'exact'
  | 'receiver-bounded'
  | 'parameter-relative'
  | 'unbounded'
  | 'rejected';

export interface CorpusDescriptor {
  name: string;
  description: string;
  category: string;
  expect: 'accept' | 'reject';
  manualAdaptations: string[];
  unsupportedConstructs: string[];
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface ClassifiedSite extends SourceLocation {
  kind: 'mutation' | 'effect-call' | 'rejection';
  syntax: string;
  canonicalKeys: string[];
  tier: AnalysisTier;
  detail: string;
}

export interface TierCounts {
  exact: number;
  'receiver-bounded': number;
  'parameter-relative': number;
  unbounded: number;
  rejected: number;
}

export interface CoverageModeResult {
  mode: 'linked' | 'function-summaries-ablated';
  accepted: boolean;
  error?: string;
  counts: TierCounts;
  sites: ClassifiedSite[];
  readers: Record<string, string[]>;
  readerKeys: number;
  readerEdges: number;
}

export interface CorpusResult {
  descriptor: CorpusDescriptor;
  loc: number;
  modules: number;
  linked: CoverageModeResult;
  ablated: CoverageModeResult;
}
