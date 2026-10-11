/** Refine exported content candidates with caller evidence from the whole project. */
import { resolveRenderUsage, type RenderUsage } from '../components/render-usage';
import type { ModuleManifest } from './model';

export function resolveProjectRenderUsage(manifests: ReadonlyMap<string, ModuleManifest>) {
  const usage = resolveRenderUsage(
    [...manifests.values()].flatMap((manifest) => manifest.componentUsages),
  );
  for (const [target, contract] of usage) {
    for (const prop of contract.jsx) {
      if (contract.scalar.has(prop)) {
        throw new Error(
          `memo-dom: component '${target}' prop '${prop}' is used as both scalar data and JSX content; split the prop or component contract`,
        );
      }
    }
  }
  return usage;
}

export function refineRenderProps(
  key: string,
  candidates: readonly string[],
  usage: ReadonlyMap<string, RenderUsage>,
): string[] {
  const contract = usage.get(key);
  return candidates.filter((prop) => contract?.scalar.has(prop) !== true || contract.jsx.has(prop));
}

export function localRenderProps(
  manifest: ModuleManifest,
  usage: ReadonlyMap<string, RenderUsage>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const declaration of manifest.components) {
    const exported = Object.values(manifest.exports).find(
      (candidate) => candidate.type === 'component' && candidate.key === declaration.key,
    );
    if (exported?.type === 'component') {
      result[declaration.local] = refineRenderProps(declaration.key, exported.renderProps, usage);
    }
  }
  return result;
}
