/**
 * Owns per-Vite-environment linked output and compilation coordination.
 */
import type { CompilerSourceMap } from '@memoized-dom/compiler';
import type { CompiledGraph } from './graph/collector';

export class AdapterState {
  readonly files = new Set<string>();
  readonly output = new Map<string, string>();
  readonly maps = new Map<string, CompilerSourceMap>();
  readonly css = new Map<string, string>();
  readonly styles = new Set<string>();
  readonly eagerStyles = new Set<string>();
  routeStyles: readonly {
    readonly id: string;
    readonly pattern: string;
    readonly styles: ReadonlySet<string>;
  }[] = [];
  routeTree: readonly {
    readonly id: string;
    readonly pattern: string;
    readonly parentId?: string;
  }[] = [];
  entry?: string;
  compiling: Promise<CompiledGraph> | undefined;
  hotUpdateFailed = false;
  replace(graph: CompiledGraph): void {
    this.files.clear();
    for (const file of graph.files) this.files.add(file);
    this.output.clear();
    for (const [file, code] of graph.output) this.output.set(file, code);
    this.maps.clear();
    for (const [file, map] of graph.maps) this.maps.set(file, map);
    this.css.clear();
    for (const [file, style] of graph.css) this.css.set(file, style);
    this.styles.clear();
    for (const file of graph.styles) this.styles.add(file);
    this.eagerStyles.clear();
    for (const file of graph.eagerStyles) this.eagerStyles.add(file);
    this.routeStyles = graph.routeStyles;
    this.routeTree = graph.routeTree;
  }
}
