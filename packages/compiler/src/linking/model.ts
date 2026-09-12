import type * as t from '../ast/compiler-types';
import type { BaseNode, EstreeFrontend } from '../ast';
import type { ComponentGraphNode } from '../component-linker';
import type { ComponentExportInfo } from '../components/manifest';
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
  frontend?: EstreeFrontend;
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
  transparentSourceFactory?: boolean;
  transparentSourceMethod?: TransparentSourceMethod;
  tagCandidates: string[];
  componentCandidates: string[];
  reads: string[];
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
  readers: Record<string, string[]>;
}

export interface ModuleEntry {
  originalId: string;
  id: string;
  source: string;
  ast: t.Program;
  css?: string;
}

export interface LinkResolutionOptions {
  aliases?: Readonly<Record<string, string>>;
  resolveImport?: (specifier: string, importer: string) => string | undefined;
  linkFunctionSummaries?: boolean;
}
