import { build, type Plugin } from 'esbuild';
import { resolveModuleId } from '../shared';
import type { OracleCase } from './cases';
import { instrumentProgram } from './instrument';
import { OracleRuntime, type OracleComputation, pathsTouch } from './runtime';
import type { CompiledModuleMetadata } from '@memoized-dom/compiler';

export interface OracleRow {
  case: string;
  category: string;
  scenario: string;
  writes: string[];
  staticSelected: string[];
  oracleObserved: string[];
  changed: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

interface LoadedModule {
  __oracleComputations: OracleComputation[];
  [name: string]: unknown;
}

export async function executeOracleCase(
  testCase: OracleCase,
  metadata: Readonly<Record<string, CompiledModuleMetadata>>,
): Promise<OracleRow[]> {
  const instrumented = instrumentProgram(testCase.modules);
  const ids = Object.keys(instrumented.modules);
  const runtime = new OracleRuntime();
  (globalThis as Record<string, unknown>).__MEMO_EVAL_ORACLE__ = runtime.api;

  try {
    const modules = await bundleAndLoad(instrumented.modules, ids);
    const computations = modules.flatMap((module) => module.__oracleComputations);
    runtime.initialize(computations);

    const readerTable = mergeReaders(metadata);
    const rows: OracleRow[] = [];
    for (const scenario of testCase.scenarios) {
      const moduleIndex = ids.indexOf(scenario.moduleId);
      if (moduleIndex < 0) throw new Error(`missing scenario module ${scenario.moduleId}`);
      const mutation = modules[moduleIndex]![scenario.exportedMutation];
      if (typeof mutation !== 'function') {
        throw new Error(`missing mutation export ${scenario.moduleId}#${scenario.exportedMutation}`);
      }
      const concrete = runtime.executeMutation(
        () => (mutation as (...args: unknown[]) => void)(...(scenario.arguments ?? [])),
        computations,
      );
      const changed = new Set(concrete.changed);
      const staticSelected = selectClosure(
        concrete.writes,
        (write) => staticReadersForWrite(write, readerTable),
        changed,
        instrumented.computationKeys,
      );
      const oracleObserved = selectClosure(
        concrete.writes,
        (write) =>
          Object.entries(concrete.dependenciesBefore)
            .filter(([, reads]) => reads.some((read) => pathsTouch(read, write)))
            .map(([id]) => id),
        changed,
        instrumented.computationKeys,
      );
      const intersection = new Set(
        [...staticSelected].filter((id) => oracleObserved.has(id)),
      );
      const falseNegatives = [...oracleObserved].filter((id) => !staticSelected.has(id));
      if (falseNegatives.length > 0) {
        throw new Error(
          `${testCase.name}/${scenario.name}: oracle observed entities omitted by static selection: ${falseNegatives.join(', ')}`,
        );
      }
      rows.push({
        case: testCase.name,
        category: testCase.category,
        scenario: scenario.name,
        writes: concrete.writes,
        staticSelected: [...staticSelected].sort(),
        oracleObserved: [...oracleObserved].sort(),
        changed: concrete.changed.sort(),
        truePositives: intersection.size,
        falsePositives: staticSelected.size - intersection.size,
        falseNegatives: falseNegatives.length,
        precision: staticSelected.size === 0 ? 1 : intersection.size / staticSelected.size,
        recall: oracleObserved.size === 0 ? 1 : intersection.size / oracleObserved.size,
      });
    }
    return rows;
  } finally {
    delete (globalThis as Record<string, unknown>).__MEMO_EVAL_ORACLE__;
    delete (globalThis as Record<string, unknown>).__MEMO_EVAL_EXPORTS__;
  }
}

function mergeReaders(
  metadata: Readonly<Record<string, CompiledModuleMetadata>>,
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const moduleMetadata of Object.values(metadata)) {
    for (const [key, patterns] of Object.entries(moduleMetadata.readers)) {
      const readers = merged.get(key) ?? new Set<string>();
      for (const pattern of patterns) readers.add(pattern);
      merged.set(key, readers);
    }
  }
  return merged;
}

function staticReadersForWrite(
  write: string,
  readers: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const selected = new Set<string>();
  for (const [read, entities] of readers) {
    if (!pathsTouch(read, write)) continue;
    for (const entity of entities) selected.add(entity);
  }
  return [...selected];
}

function selectClosure(
  initialWrites: readonly string[],
  readersForWrite: (write: string) => readonly string[],
  changed: ReadonlySet<string>,
  computationKeys: Readonly<Record<string, string>>,
): Set<string> {
  const selected = new Set<string>();
  const queuedWrites = [...initialWrites];
  const seenWrites = new Set<string>();
  while (queuedWrites.length > 0) {
    const write = queuedWrites.shift()!;
    if (seenWrites.has(write)) continue;
    seenWrites.add(write);
    for (const entity of readersForWrite(write)) {
      if (selected.has(entity)) continue;
      selected.add(entity);
      const computedKey = computationKeys[entity];
      if (computedKey !== undefined && changed.has(entity)) queuedWrites.push(computedKey);
    }
  }
  return selected;
}

async function bundleAndLoad(
  modules: Readonly<Record<string, string>>,
  ids: readonly string[],
): Promise<LoadedModule[]> {
  const entry = [
    ...ids.map((id, index) => `import * as M${index} from ${JSON.stringify(id)};`),
    `globalThis.__MEMO_EVAL_EXPORTS__ = [${ids.map((_, index) => `M${index}`).join(',')}];`,
  ].join('\n');
  const plugin: Plugin = {
    name: 'oracle-virtual-modules',
    setup(context) {
      context.onResolve({ filter: /^oracle:entry$/ }, () => ({ path: 'oracle:entry', namespace: 'oracle' }));
      context.onResolve({ filter: /^\./, namespace: 'oracle' }, (args) => {
        if (args.importer === 'oracle:entry') {
          if (!(args.path in modules)) return null;
          return { path: args.path, namespace: 'oracle' };
        }
        const resolved = resolveModuleId(args.importer, args.path, modules);
        return resolved === undefined ? null : { path: resolved, namespace: 'oracle' };
      });
      context.onLoad({ filter: /.*/, namespace: 'oracle' }, (args) => {
        const contents = args.path === 'oracle:entry' ? entry : modules[args.path];
        if (contents === undefined) return null;
        return {
          contents,
          loader: args.path.endsWith('x') ? 'tsx' : 'ts',
          resolveDir: '/',
        };
      });
    },
  };
  const result = await build({
    entryPoints: ['oracle:entry'],
    bundle: true,
    format: 'iife',
    platform: 'node',
    write: false,
    plugins: [plugin],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0]!.text;
  new Function(code)();
  return (globalThis as Record<string, unknown>).__MEMO_EVAL_EXPORTS__ as LoadedModule[];
}
