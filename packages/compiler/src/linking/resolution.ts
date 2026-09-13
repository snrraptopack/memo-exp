import { posix } from 'node:path';
import type {
  LinkedDynamicComponentCandidate,
  LinkedImport,
} from '../context';
import type {
  LinkResolutionOptions,
  ModuleEntry,
  ModuleManifest,
  RenderUsage,
} from './model';

export function canonicalModuleId(raw: string): string {
  const slashed = raw.replace(/\\/g, '/');
  const normalized = posix.normalize(slashed);
  // posix.normalize removes a leading "./"; preserve it when the caller used
  // a project-relative id. Bare ids and aliases (`@/x`, `virtual:x`) must not
  // be rewritten as relative paths.
  if (slashed.startsWith('./') && !normalized.startsWith('../')) {
    return `./${normalized}`;
  }
  return normalized;
}

export function resolveModule(
  importer: string,
  specifier: string,
  entries: ReadonlyMap<string, ModuleEntry>,
  options: LinkResolutionOptions,
): ModuleEntry | undefined {
  const hostResolved = options.resolveImport?.(specifier, importer);
  let resolved = hostResolved;
  if (resolved === undefined) {
    const aliases = Object.entries(options.aliases ?? {}).sort(
      ([a], [b]) => b.length - a.length,
    );
    for (const [prefix, target] of aliases) {
      const matches = prefix.endsWith('/')
        ? specifier.startsWith(prefix)
        : specifier === prefix || specifier.startsWith(`${prefix}/`);
      if (!matches) continue;
      resolved = `${target}${specifier.slice(prefix.length)}`;
      break;
    }
  }
  if (resolved === undefined) {
    if (specifier.startsWith('.')) {
      const joined = posix.normalize(posix.join(posix.dirname(importer), specifier));
      resolved =
        importer.startsWith('./') && !joined.startsWith('../') ? `./${joined}` : joined;
    } else {
      resolved = specifier;
    }
  }
  const base = canonicalModuleId(resolved ?? specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
  for (const candidate of candidates) {
    const found = entries.get(candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function relativeModuleSpecifier(importer: string, target: string): string {
  if (!target.startsWith('.')) return target;
  const relative = posix.relative(posix.dirname(importer), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function linkedDynamicCandidates(
  importer: ModuleEntry,
  keys: readonly string[],
  manifests: Map<string, ModuleManifest>,
): LinkedDynamicComponentCandidate[] {
  return keys.map((key) => {
    for (const [moduleId, manifest] of manifests) {
      for (const [exported, candidate] of Object.entries(manifest.exports)) {
        if (candidate.type !== 'component' || candidate.key !== key) continue;
        return {
          key: candidate.key,
          source: relativeModuleSpecifier(importer.id, moduleId),
          imported: exported,
          props: [...candidate.props],
          objectProps: candidate.objectProps,
          acceptsUnknownProps: candidate.acceptsUnknownProps,
          hasWholeDefault: candidate.hasWholeDefault,
          listLightweight: candidate.listLightweight,
          delegatedEvents: candidate.delegatedEvents,
          renderProps: [...candidate.renderProps],
          renderCallbacks: [...candidate.renderCallbacks],
          refProps: [...candidate.refProps],
          subtreeReads: [...candidate.subtreeReads],
        };
      }
    }
    throw new Error(
      `memo-dom: dynamic component candidate '${key}' is not exported; export the component so consuming modules can link it`,
    );
  });
}

export function linkImports(
  entry: ModuleEntry,
  manifest: ModuleManifest,
  manifests: Map<string, ModuleManifest>,
  entries: ReadonlyMap<string, ModuleEntry>,
  options: LinkResolutionOptions,
  renderUsage?: ReadonlyMap<string, RenderUsage>,
): Record<string, LinkedImport> {
  const linked: Record<string, LinkedImport> = {};
  for (const ref of manifest.imports) {
    const target = resolveModule(entry.id, ref.source, entries, options);
    if (target === undefined) {
      // Calls through external imports are conservatively unbounded. If the
      // binding is only read as ordinary data, it remains non-reactive.
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [],
        componentCandidates: [],
        reads: [],
        writes: [],
        boundedWrites: [],
        parameterWrites: [],
        unbounded: true,
      };
      continue;
    }
    if (ref.imported === '*') {
      throw new Error(
        `memo-dom: namespace import '${ref.local}' from '${ref.source}' cannot identify a reactive export; use named imports`,
      );
    }
    const targetExport = manifests.get(target.id)?.exports[ref.imported];
    if (targetExport === undefined) {
      // Early fixed-point passes may not have discovered a re-export yet.
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [],
        componentCandidates: [],
        reads: [],
        writes: [],
        boundedWrites: [],
        parameterWrites: [],
        unbounded: true,
      };
      continue;
    }
    if (targetExport.type === 'state') {
      linked[ref.local] = {
        type: 'state',
        kind: targetExport.kind,
        key: targetExport.key,
        transparentSource: (targetExport as { transparentSource?: boolean })
          .transparentSource,
        tagCandidates: [...targetExport.tagCandidates],
        componentCandidates: linkedDynamicCandidates(
          entry,
          targetExport.componentCandidates,
          manifests,
        ),
      };
    } else if (targetExport.type === 'component') {
      const usage = renderUsage?.get(targetExport.key);
      const renderProps = targetExport.renderProps.filter(
        (prop) =>
          usage?.scalar.has(prop) !== true || usage.jsx.has(prop),
      );
      linked[ref.local] = {
        type: 'component',
        key: targetExport.key,
        props: [...targetExport.props],
        objectProps: targetExport.objectProps,
        acceptsUnknownProps: targetExport.acceptsUnknownProps,
        hasWholeDefault: targetExport.hasWholeDefault,
        listLightweight: targetExport.listLightweight,
        delegatedEvents: targetExport.delegatedEvents,
        renderProps,
        renderCallbacks: [...targetExport.renderCallbacks],
        refProps: [...targetExport.refProps],
        subtreeReads: [...targetExport.subtreeReads],
      };
    } else if (targetExport.type === 'value') {
      linked[ref.local] = {
        type: 'value',
      };
      continue;
    } else {
      if (options.linkFunctionSummaries === false) {
        linked[ref.local] = {
          type: 'function',
          transparentSourceFactory: targetExport.transparentSourceFactory,
          transparentSourceMethod: targetExport.transparentSourceMethod,
          tagCandidates: [...targetExport.tagCandidates],
          componentCandidates: linkedDynamicCandidates(
            entry,
            targetExport.componentCandidates,
            manifests,
          ),
          reads: [],
          writes: [],
          boundedWrites: [],
          parameterWrites: [],
          unbounded: true,
        };
        continue;
      }
      linked[ref.local] = {
        type: 'function',
        transparentSourceFactory: targetExport.transparentSourceFactory,
        transparentSourceMethod: targetExport.transparentSourceMethod,
        tagCandidates: [...targetExport.tagCandidates],
        componentCandidates: linkedDynamicCandidates(
          entry,
          targetExport.componentCandidates,
          manifests,
        ),
        reads: [...targetExport.reads],
        writes: [...targetExport.writes],
        boundedWrites: [...targetExport.boundedWrites],
        parameterWrites: [...targetExport.parameterWrites],
        unbounded: targetExport.unbounded,
      };
    }
  }
  return linked;
}
