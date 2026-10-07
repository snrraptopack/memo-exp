/** Authored initial-content structure and source identity, without host addresses or output. */
import type { BaseNode } from '../ast';

export type InitialRenderNode =
  | { readonly kind: 'text'; readonly value: string; readonly live?: boolean }
  | { readonly kind: 'browser'; readonly id: number; readonly site: string }
  | { readonly kind: 'component'; readonly site: string; readonly moduleId: string; readonly callModuleId: string; readonly component: string;
      readonly children: readonly InitialRenderNode[]; readonly static?: boolean; readonly creation?: true;
      /** Authored content slots are omitted only with an entirely static callee. */
      readonly staticChildren?: true }
  | { readonly kind: 'slot'; readonly site: string; readonly moduleId: string; readonly component: string;
      readonly children: readonly InitialRenderNode[]; readonly static?: true;
      readonly creation?: true;
      readonly mount?: { readonly moduleId: string; readonly component: string; readonly site: string } }
  | { readonly kind: 'conditional'; readonly site: string; readonly branch: number | null;
      readonly children: readonly InitialRenderNode[]; readonly alternatives?: readonly (readonly InitialRenderNode[])[] }
  | { readonly kind: 'list'; readonly site: string; readonly rows: readonly (readonly InitialRenderNode[])[];
      readonly requestRow?: readonly InitialRenderNode[] }
  | { readonly kind: 'element'; readonly tag: string;
      readonly site?: string;
      readonly attributes: readonly InitialRenderAttribute[];
      readonly children: readonly InitialRenderNode[] };

export interface InitialRenderAttribute {
  readonly name: string;
  readonly value: string | number | boolean | null | undefined;
  readonly site?: string;
  readonly live?: boolean;
}

export interface BrowserRequirement {
  readonly moduleId: string;
  readonly kind: 'event' | 'ref' | 'lifecycle' | 'unknown';
  readonly detail: string;
}

export interface InitialOwnerRequirement {
  readonly moduleId:string;
  readonly component:string;
  readonly features:readonly ('ref'|'effect'|'cleanup')[];
}

export type InitialRenderPlan =
  | { readonly kind: 'html'; readonly target: string;
      readonly mountModuleId: string; readonly nodes: readonly InitialRenderNode[]; readonly exposedMutableValues?: true }
  | { readonly kind: 'mixed'; readonly target: string; readonly mountModuleId: string;
      readonly rootModuleId: string; readonly rootLocal: string; readonly returnSite: string;
      readonly nodes: readonly InitialRenderNode[];
      readonly regions: readonly { readonly id: number; readonly site: string }[] }
  | { readonly kind: 'bindings'; readonly target: string; readonly mountModuleId: string;
      readonly rootModuleId: string; readonly rootLocal: string; readonly returnSite: string;
      readonly nodes: readonly InitialRenderNode[]; readonly exposedMutableValues?: true;
      readonly creationComponents?: readonly string[]; readonly request?: true;
      readonly owners?:readonly InitialOwnerRequirement[] }
  | { readonly kind: 'request'; readonly target: string; readonly mountModuleId: string;
      readonly nodes: readonly InitialRenderNode[]; readonly exposedMutableValues?: true }
  | { readonly kind: 'browser'; readonly requirements: readonly BrowserRequirement[] };

/** Authored source identity survives backend AST cloning. */
export function initialSite(node: BaseNode): string {
  return node.loc ? `${node.loc.start.line}:${node.loc.start.column}` : '';
}

/** Compiler-private identity of one authored interpolation that mounts a slot. */
export function initialSlotMountKey(moduleId: string, component: string, site: string): string {
  return `${moduleId}#${component}#${site}`;
}
