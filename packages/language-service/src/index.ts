import type * as ts from 'typescript';
import { createLanguageService } from './plugin';

type TypeScript = typeof ts;

/**
 * tsserver requires the package's CommonJS value to be this factory function.
 * The package build footer unwraps this default export after bundling.
 */
export default function initialize({
  typescript,
}: {
  typescript: TypeScript;
}): ts.server.PluginModule {
  return {
    create(info) {
      return createLanguageService(typescript, info);
    },
  };
}
