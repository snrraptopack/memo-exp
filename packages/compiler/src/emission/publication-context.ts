/** AST allocation and callback publication state shared by rendering targets. */
import type * as t from '../ast/compiler-types';
import type { BaseNode } from '../ast';
import type { CellEmissionContext } from '../cells';
import type { RowWriteFacts } from '../handlers/write-facts';

export interface PublicationEmissionContext extends CellEmissionContext {
  emission: CellEmissionContext['emission'] & {
    writeConstCounter: number;
    writeConsts: Map<string, string>;
    reasonConstCounter: number;
    reasonConsts: Map<string, string>;
  };
  instanceReasonIds: Map<string, Map<string, number>>;
  callbackPublications: Set<BaseNode>;
  handlerHasRootCommit: WeakMap<t.Node, boolean>;
}

/** Generated lexical bindings, supplied after shared row-write analysis. */
export interface HandlerRowTarget extends Omit<RowWriteFacts, 'localRefresh'> {
  rowIdVar: string;
  refreshVar?: string;
  ownerIdVar?: string;
}
