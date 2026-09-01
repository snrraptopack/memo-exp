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
