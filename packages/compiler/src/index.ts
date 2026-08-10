/** Public compiler package entry. */

export {
  compile,
  compileDetailed,
  type CompiledSource,
  type CompilerSourceMap,
  type MemoDomOptions,
} from './compile';
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
