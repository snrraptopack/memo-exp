/** Desktop supplies scene normalization to the shared source-analysis pipeline. */
import { prepareSemanticAnalysis, type SemanticAnalysisProfile } from '../analysis/pipeline';
import { pathVariants } from '../analysis/component-graph';
import { createAnalysisCtx, type Ctx, type ProgramPath } from '../context';
import { planCompilerIntrinsics } from '../intrinsics';
import { scanRefProps } from '../components/ref-props';
import * as b from '../ast/factory';
import { unwrapTypeExpression } from '../ast/normalize';
import { nodeHasJsx } from '../context/ast';
import { analyzeComponent } from '../analysis/component-validation';
import type { ManifestAnalysis } from '../linking/analysis';
import { prepareDesktopListSources } from './lists';
import { planDesktopAccessReaders } from './access';

const desktopAnalysisProfile: SemanticAnalysisProfile<Ctx> = {
  install: planCompilerIntrinsics,
  normalizeComponents(ctx) {
    scanRefProps(ctx);
    // The return planner consumes JSX roots. Desktop's existing expression
    // roots become one fragment without changing their evaluation boundary.
    for (const component of ctx.compPaths.values()) {
      const final = component.node.body.body.at(-1);
      if (!final || !b.isReturnStatement(final) || !final.argument) continue;
      const expression = unwrapTypeExpression(final.argument);
      if (b.isJSXElement(expression) || b.isJSXFragment(expression)) {
        final.argument = expression;
      } else if (nodeHasJsx(expression)) {
        final.argument = b.jsxFragment(b.jsxOpeningFragment(), b.jsxClosingFragment(), [
          b.jsxExpressionContainer(expression),
        ]);
      }
    }
  },
  validateComponents(ctx) {
    for (const name of ctx.comps.keys()) analyzeComponent(ctx, name, { nullishChoices: true });
  },
  beforeReads(ctx) {
    for (const component of ctx.compPaths.values()) {
      prepareDesktopListSources(component.node.body, ctx);
    }
  },
  finish(ctx) {
    // Recursive composition is invalid even if it reads no state.
    for (const name of ctx.comps.keys()) pathVariants(ctx, name);
  },
};

export function prepareDesktopAnalysis(ctx: Ctx, path: ProgramPath): void {
  prepareSemanticAnalysis(ctx, path, desktopAnalysisProfile);
}

export const desktopManifestAnalysis: ManifestAnalysis = {
  prepare(path, options) {
    const ctx = createAnalysisCtx({ ...options, moduleStateCells: true });
    prepareDesktopAnalysis(ctx, path);
    return ctx;
  },
  readers: planDesktopAccessReaders,
  // Native rows retain owners; the DOM's synchronous row optimization has no
  // corresponding scene ABI and must never be inferred during native linking.
  listResourceFree: () => false,
};
