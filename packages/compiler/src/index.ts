/** Public compiler package entry. */

export {
  compile,
  compileDetailed,
  type CompiledSource,
  type CompileOptions,
  type CompilerSourceMap,
  type MemoDomOptions,
} from './compile';
export {
  createExtensionEstreeFrontend,
  EstreeParseError,
  parseWithEstreeFrontend,
  parseWithEstreeFrontendOrThrow,
  yukuEstreeFrontend,
  type EstreeFrontend,
  type ParseEstreeOptions,
  type ParsedEstree,
} from './ast/parser';
export {
  experimentalTsrxEstreeFrontend,
  memoizedEstreeFrontend,
  parseTsrxEstree,
} from './ast/tsrx';
export {
  compileModules,
  compileModulesDetailed,
  type CompiledComponentExport,
  type CompiledFunctionExport,
  type CompiledModuleMetadata,
  type CompiledModules,
  type CompiledRouteDefinition,
  type CompiledRoutePattern,
  type CompiledStateExport,
  type CompileModulesOptions,
} from './linker';
export {
  compilerDiagnosticCode,
  compilerDiagnosticSource,
  diagnose,
  diagnoseModules,
  toCompilerDiagnostic,
  type CompilerDiagnostic,
} from './diagnostics';
export {
  analyzeServerFunctionModule,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
  serverFunctionModuleName,
  type AnalyzeServerFunctionOptions,
  type ServerFunctionDeclarationOptions,
  type ServerFunctionDefinition,
  type ServerFunctionMethod,
  type ServerFunctionModule,
  type ServerFunctionParameter,
  type ServerFunctionQueryKind,
} from './server-functions';
export {
  compilerError,
  MemoizedDomCompilerError,
  type CompilerErrorAnchor,
  type CompilerErrorLocation,
} from './errors';
export type { CompilerRoutedPreparation } from './routed';
export type { ExternalReactiveSourceDefinition } from './context';
