/** Source facts for structural replay; runtime reasons and regions are backend inputs. */
import type * as t from '../ast/compiler-types';
import { walkAst } from '../ast';
import { canonicalKeyFor } from '../context/state-keys';

export interface ListReplaySource {
  readonly sourceExpr: t.Expression;
  readonly sourceKey: string;
  readonly sourceLocal: boolean;
  readonly hasPrelude: boolean;
}

export interface ListReplayFacts {
  readonly structuralSource: string;
  readonly fixedPositions: boolean;
  readonly moduleIndices: boolean;
  /** Ordinary cause for wholly structural sources, otherwise a dedicated safe-write cause. */
  readonly ownerStructuralReason?: number;
}

export interface ComponentRegionReplay {
  readonly listFor: (call: t.Node, source: ListReplaySource) => ListReplayFacts;
  readonly conditionFromOwner: (expression: t.Node) => boolean;
}

export interface RegionReplayEnvironment {
  readonly ownerRoots: ReadonlySet<string>;
  readonly volatile: boolean;
  readonly moduleIndexSources: ReadonlySet<string>;
  readonly stateKeys: ReadonlyMap<string, string>;
  /** Binding identity was checked before backend mutation; clones are unproven. */
  readonly fixedSourceFor: (call: t.Node) => string | undefined;
  readonly ownerStructureFor?: (call: t.Node) => { source: string; reason: number } | undefined;
}

export function createRegionReplayFacts(environment: RegionReplayEnvironment): ComponentRegionReplay {
  const ownerRoots = new Set(environment.ownerRoots);
  const volatile = environment.volatile;
  const moduleIndexSources = new Set(environment.moduleIndexSources);
  const stateKeys = new Map(environment.stateKeys);
  const fixedSourceFor = environment.fixedSourceFor;
  const ownerStructureFor = environment.ownerStructureFor;
  return {
    listFor(call, source) {
      const identifier = source.sourceExpr.type === 'Identifier' ? source.sourceExpr.name : null;
      const ownerStructure = ownerStructureFor?.(call);
      return {
        structuralSource: source.sourceLocal ? '' : canonicalKeyFor(stateKeys, source.sourceKey),
        fixedPositions: !source.hasPrelude && identifier !== null && fixedSourceFor(call) === identifier,
        moduleIndices: !source.hasPrelude && !source.sourceLocal && identifier !== null &&
          moduleIndexSources.has(identifier),
        ...(source.sourceLocal && !source.hasPrelude && identifier === ownerStructure?.source
          ? { ownerStructuralReason: ownerStructure.reason } : {}),
      };
    },
    conditionFromOwner(expression) {
      if (volatile) return true;
      if (ownerRoots.size === 0) return false;
      let reads = false;
      walkAst<t.Node>(expression, { enter(node) {
        if (reads) return false;
        if (node.type === 'Identifier' && ownerRoots.has((node as t.Identifier).name)) {
          reads = true;
          return false;
        }
      }});
      return reads;
    },
  };
}
