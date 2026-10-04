/** Captured callback writes, consumed separately by target instrumentation. */
import type * as t from '../ast/compiler-types';
import type { RowCtx } from '../context';
import type { ScopeWrites } from '../handler-commits';
import type { CapturedOwnerListWrites } from '../analysis/owner-list-structure';
import type { HandlerPath } from './traversal';

export interface HandlerExecutionSite {
  path: HandlerPath;
  writes: ScopeWrites;
  flag?: t.Identifier;
  temporaries?: t.Identifier[];
}

export interface HandlerWritePlan {
  original: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  copy: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  scopes: Map<t.Node, ScopeWrites>;
  executionSites: ReadonlyMap<t.Node, HandlerExecutionSite>;
  listWrites: CapturedOwnerListWrites;
  owner: string | null;
  row: RowCtx | undefined;
  eventBoundary: boolean;
  eventOriginId: t.Expression | undefined;
  executionAwareRoot: boolean;
}
