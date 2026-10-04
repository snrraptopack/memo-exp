import type * as t from '../ast/compiler-types';
import type { AstComment, BaseNode, EstreeFrontend } from '../ast';
import type { ComponentGraphNode } from '../component-linker';
import type { PlainListReturn } from '../analysis/plain-list-return';
import type { ComponentExportInfo } from '../components/manifest';
import type { CompilerRoutedPreparation } from '../routed';
import type { InitialRenderPlan } from '../planning/initial-render';
import type { InitialDelivery } from '../planning/initial-delivery';
import type {
  ParameterWrite,
  MemoDomOptions,
  StateKind,
  TransparentSourceMethod,
} from '../context';

export interface CompileModulesOptions
  extends Omit<
    MemoDomOptions,
    | 'moduleId'
    | 'linkedImports'
    | 'linkedComponentPaths'
    | 'linkedComponentRows'
    | 'linkedComponentPropSources'
    | 'linkedComponentRenderProps'
  > {
  aliases?: Readonly<Record<string, string>>;
  resolveImport?: (specifier: string, importer: string) => string | undefined;
  linkFunctionSummaries?: boolean;
  /** Keep build graphs strict; editor-wide diagnostics can inspect multiple roots. */
  enforceSingleApplicationRoot?: boolean;
  frontend?: EstreeFrontend;
  /** Emit one browser program for an HTML document, when its initial content is proved.
   * A host predicate can validate its shell before emission. Direct JS entries omit this.
   */
  initialContent?: boolean | ((plan: InitialRenderPlan, delivery: InitialDelivery | undefined) => boolean);
}

export interface StateExport {
  type: 'state';
  kind: StateKind;
  key: string;
  transparentSource?: boolean;
  tagCandidates: string[];
  componentCandidates: string[];
}

export interface FunctionExport {
  type: 'function';
  plainListReturn?: PlainListReturn;
  transparentSourceFactory?: boolean;
  transparentSourceMethod?: TransparentSourceMethod;
  tagCandidates: string[];
  componentCandidates: string[];
  reads: string[];
  opaqueReads?: boolean;
  writes: string[];
  boundedWrites: string[];
  parameterWrites: ParameterWrite[];
  unbounded: boolean;
}

export interface ComponentExport extends ComponentExportInfo {
  type: 'component';
}

export interface ValueExport { type: 'value' }

export type LinkedExport =
  | StateExport
  | FunctionExport
  | ComponentExport
  | ValueExport;

export interface ImportRef {
  local: string;
  imported: string;
  source: string;
  at: BaseNode;
}

export interface ComponentPropUsage {
  target: string;
  prop: string;
  kind: 'jsx' | 'scalar';
}

export interface RenderUsage {
  jsx: Set<string>;
  scalar: Set<string>;
}

export interface ModuleManifest {
  exports: Record<string, LinkedExport>;
  imports: ImportRef[];
  mounts: string[];
  components: ComponentGraphNode[];
  componentUsages: ComponentPropUsage[];
  routedPreparations: CompilerRoutedPreparation[];
  readers: Record<string, string[]>;
}

export interface ModuleEntry {
  originalId: string;
  id: string;
  source: string;
  ast: t.Program;
  comments?: readonly AstComment[];
  css?: string;
}

export interface LinkResolutionOptions {
  aliases?: Readonly<Record<string, string>>;
  resolveImport?: (specifier: string, importer: string) => string | undefined;
  linkFunctionSummaries?: boolean;
}
