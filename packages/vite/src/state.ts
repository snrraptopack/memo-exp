/**
 * Owns per-Vite-environment linked output and compilation coordination.
 */
import type { CompiledGraph } from './graph/collector';

export class AdapterState {
  readonly files = new Set<string>();
  readonly output = new Map<string, string>();
  compiling: Promise<CompiledGraph> | undefined;

  replace(graph: CompiledGraph): void {
    this.files.clear();
    for (const file of graph.files) this.files.add(file);
    this.output.clear();
    for (const [file, code] of graph.output) this.output.set(file, code);
  }

}
