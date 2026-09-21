import type { InternalMemoDomOptions } from '../context';
import type { CompileModulesOptions } from './model';

export function compilerOptions(
  options: CompileModulesOptions,
  rootId = 'App',
): InternalMemoDomOptions {
  return {
    ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
    ...(options.hotRuntimePath === undefined ? {} : { hotRuntimePath: options.hotRuntimePath }),
    ...(options.routerPath === undefined ? {} : { routerPath: options.routerPath }),
    ...(options.dataRuntimePath === undefined ? {} : { dataRuntimePath: options.dataRuntimePath }),
    ...(options.transparentAsyncSources === undefined
      ? {}
      : { transparentAsyncSources: options.transparentAsyncSources }),
    ...(options.externalReactiveSources === undefined
      ? {}
      : { externalReactiveSources: options.externalReactiveSources }),
    ...(options.hot === undefined ? {} : { hot: options.hot }),
    ...(options.moduleStateCells === undefined ? {} : { moduleStateCells: options.moduleStateCells }),
    ...(options.routedEnvironment === undefined
      ? {}
      : { routedEnvironment: options.routedEnvironment }),
    rootId,
  };
}
