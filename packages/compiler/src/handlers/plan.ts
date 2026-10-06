/** Captured callback writes, consumed separately by target instrumentation. */
import type * as t from '../ast/compiler-types';
import type { RowWriteFacts, ScopeWrites } from './write-facts';
import type { CapturedOwnerListWrites } from '../analysis/owner-list-structure';
import type { HandlerPath } from './traversal';

export interface HandlerExecutionSite {
  path: HandlerPath;
  writes: ScopeWrites;
}

export interface HandlerMutationSite {
  path:HandlerPath;
  source:string;
  key:t.Expression;
}

export interface HandlerWritePlan {
  original: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  copy: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  scopes: Map<t.Node, ScopeWrites>;
  executionSites: ReadonlyMap<t.Node, HandlerExecutionSite>;
  mutationSites:readonly HandlerMutationSite[];
  listWrites: CapturedOwnerListWrites;
  owner: string | null;
  row: RowWriteFacts | undefined;
  eventBoundary: boolean;
  executionAwareRoot: boolean;
}
