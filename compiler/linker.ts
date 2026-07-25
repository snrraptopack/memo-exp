/**
 * Two-pass module linker for canonical cross-file state identity.
 *
 * Pass 1 discovers exported state and function summaries. Subsequent passes
 * resolve import aliases and propagate summaries through re-exports/calls.
 * The final compile receives binding metadata, while emitted ES imports remain
 * untouched for the host bundler.
 */
import { posix } from 'node:path';
import { transformSync } from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import transformTypescript from '@babel/plugin-transform-typescript';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { runAnalysis } from './analysis';
import { compile } from './compile';
import { summarizeHelper } from './helper-summaries';
import {
  canonicalStateKey,
  createCtx,
  isConstCollection,
  isStoreObject,
  type LinkedImport,
  type MemoDomOptions,
  type StateKind,
} from './context';

export interface CompileModulesOptions
  extends Omit<MemoDomOptions, 'moduleId' | 'linkedImports'> {
  /**
   * Bundler-style import aliases. Prefixes match on a segment boundary, so
   * `{ '@': './src' }` resolves both `@/state` and `@/features/todos`.
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * Optional host resolver. Return a module id present in `modules`, or
   * undefined to continue with aliases and normal relative resolution.
   */
  resolveImport?: (specifier: string, importer: string) => string | undefined;
}

interface StateExport {
  type: 'state';
  kind: StateKind;
  key: string;
}

interface FunctionExport {
  type: 'function';
  reads: string[];
  writes: string[];
  opaque: boolean;
}

type LinkedExport = StateExport | FunctionExport;

interface ImportRef {
  local: string;
  imported: string;
  source: string;
}

interface ModuleManifest {
  exports: Record<string, LinkedExport>;
  imports: ImportRef[];
}

interface ModuleEntry {
  originalId: string;
  id: string;
  source: string;
}

function canonicalModuleId(raw: string): string {
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

function compilerOptions(options: CompileModulesOptions): MemoDomOptions {
  return {
    ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
    ...(options.rootId === undefined ? {} : { rootId: options.rootId }),
  };
}

function importRefs(program: t.Program): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const stmt of program.body) {
    if (!t.isImportDeclaration(stmt) || stmt.importKind === 'type') continue;
    for (const spec of stmt.specifiers) {
      if (t.isImportSpecifier(spec)) {
        if (spec.importKind === 'type') continue;
        const imported = t.isIdentifier(spec.imported)
          ? spec.imported.name
          : spec.imported.value;
        refs.push({ local: spec.local.name, imported, source: stmt.source.value });
      } else if (t.isImportDefaultSpecifier(spec)) {
        refs.push({ local: spec.local.name, imported: 'default', source: stmt.source.value });
      } else {
        refs.push({ local: spec.local.name, imported: '*', source: stmt.source.value });
      }
    }
  }
  return refs;
}

function exportedLocals(program: t.Program): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of program.body) {
    if (!t.isExportNamedDeclaration(stmt)) continue;
    if (stmt.source !== null) {
      throw new Error(
        `memo-dom: re-export-from declarations are not supported by compileModules(); import then export the binding explicitly`,
      );
    }
    const decl = stmt.declaration;
    if (t.isVariableDeclaration(decl)) {
      for (const item of decl.declarations) {
        if (t.isIdentifier(item.id)) out.set(item.id.name, item.id.name);
      }
    } else if (t.isFunctionDeclaration(decl) && decl.id != null) {
      out.set(decl.id.name, decl.id.name);
    }
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) continue;
      const local = spec.local.name;
      const exported = t.isIdentifier(spec.exported)
        ? spec.exported.name
        : spec.exported.value;
      out.set(exported, local);
    }
  }
  return out;
}

function analyzeManifest(
  entry: ModuleEntry,
  linkedImports: Record<string, LinkedImport>,
  options: CompileModulesOptions,
): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const analysisPlugin = (): { visitor: { Program(path: NodePath<t.Program>): void } } => ({
    visitor: {
      Program(programPath) {
        const ctx = createCtx({
          ...compilerOptions(options),
          moduleId: entry.id,
          linkedImports,
        });
        runAnalysis(ctx, programPath);
        const exports: Record<string, LinkedExport> = {};
        for (const [exported, local] of exportedLocals(programPath.node)) {
          const kind = ctx.state.get(local);
          if (kind !== undefined) {
            exports[exported] = {
              type: 'state',
              kind,
              key: ctx.stateKeys.get(local) ?? `${entry.id}#${local}`,
            };
            continue;
          }
          const summary =
            ctx.importedFunctions.get(local) ??
            (ctx.helpers.has(local) ? summarizeHelper(ctx, local) : undefined);
          if (summary !== undefined) {
            exports[exported] = {
              type: 'function',
              reads: [...summary.reads].map((key) => canonicalStateKey(ctx, key)).sort(),
              writes: [...summary.writes].map((key) => canonicalStateKey(ctx, key)).sort(),
              opaque: summary.opaque,
            };
          }
        }
        manifest = {
          exports,
          imports: importRefs(programPath.node),
        };
      },
    },
  });

  transformSync(entry.source, {
    filename: entry.id,
    plugins: [
      [syntaxJsx as any, {}],
      analysisPlugin,
      [transformTypescript as any, { isTSX: true }],
    ],
    configFile: false,
    babelrc: false,
  });
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to analyze module '${entry.id}'`);
  }
  return manifest;
}

/**
 * Bootstrap export identities without analyzing component bodies. This lets
 * the first real analysis already understand imported list/store bindings.
 */
function discoverManifest(entry: ModuleEntry): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const discoveryPlugin = (): { visitor: { Program(path: NodePath<t.Program>): void } } => ({
    visitor: {
      Program(programPath) {
        const locals = new Map<string, LinkedExport>();
        for (const stmt of programPath.node.body) {
          const inner = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
          if (t.isVariableDeclaration(inner)) {
            for (const decl of inner.declarations) {
              if (!t.isIdentifier(decl.id)) continue;
              let kind: StateKind | undefined;
              if (inner.kind === 'let' || inner.kind === 'var') kind = 'let';
              else if (isStoreObject(decl.init)) kind = 'store';
              else if (isConstCollection(decl.init)) kind = 'const';
              if (kind !== undefined) {
                locals.set(decl.id.name, {
                  type: 'state',
                  kind,
                  key: `${entry.id}#${decl.id.name}`,
                });
              }
            }
          } else if (t.isFunctionDeclaration(inner) && inner.id != null) {
            locals.set(inner.id.name, {
              type: 'function',
              reads: [],
              writes: [],
              opaque: true,
            });
          }
        }
        const exports: Record<string, LinkedExport> = {};
        for (const [exported, local] of exportedLocals(programPath.node)) {
          const value = locals.get(local);
          if (value !== undefined) exports[exported] = value;
        }
        manifest = { exports, imports: importRefs(programPath.node) };
      },
    },
  });
  transformSync(entry.source, {
    filename: entry.id,
    plugins: [
      [syntaxJsx as any, {}],
      discoveryPlugin,
      [transformTypescript as any, { isTSX: true }],
    ],
    configFile: false,
    babelrc: false,
  });
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to discover module '${entry.id}'`);
  }
  return manifest;
}

function resolveModule(
  importer: string,
  specifier: string,
  entries: Map<string, ModuleEntry>,
  options: CompileModulesOptions,
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
  const base = canonicalModuleId(resolved);
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

function linkImports(
  entry: ModuleEntry,
  manifest: ModuleManifest,
  manifests: Map<string, ModuleManifest>,
  entries: Map<string, ModuleEntry>,
  options: CompileModulesOptions,
): Record<string, LinkedImport> {
  const linked: Record<string, LinkedImport> = {};
  for (const ref of manifest.imports) {
    const target = resolveModule(entry.id, ref.source, entries, options);
    if (target === undefined) {
      // Calls through external imports are conservatively opaque. If the
      // binding is only read as ordinary data, it remains non-reactive.
      linked[ref.local] = {
        type: 'function',
        reads: [],
        writes: [],
        opaque: true,
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
        reads: [],
        writes: [],
        opaque: true,
      };
      continue;
    }
    linked[ref.local] =
      targetExport.type === 'state'
        ? { type: 'state', kind: targetExport.kind, key: targetExport.key }
        : {
            type: 'function',
            reads: [...targetExport.reads],
            writes: [...targetExport.writes],
            opaque: targetExport.opaque,
          };
  }
  return linked;
}

function stableManifest(manifest: ModuleManifest): string {
  return JSON.stringify(manifest);
}

/**
 * Compile a connected set of TS/TSX modules with canonical cross-file state
 * keys. Record keys are source module ids; returned keys are preserved.
 */
export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  const entries = new Map<string, ModuleEntry>();
  for (const [originalId, source] of Object.entries(modules)) {
    const id = canonicalModuleId(originalId);
    if (entries.has(id)) {
      throw new Error(`memo-dom: duplicate module id after normalization: '${id}'`);
    }
    entries.set(id, { originalId, id, source });
  }

  let manifests = new Map<string, ModuleManifest>();
  for (const entry of entries.values()) {
    manifests.set(entry.id, discoverManifest(entry));
  }

  for (let pass = 0; pass <= entries.size; pass++) {
    let changed = false;
    const next = new Map<string, ModuleManifest>();
    for (const entry of entries.values()) {
      const previous = manifests.get(entry.id)!;
      const linked = linkImports(entry, previous, manifests, entries, options);
      const current = analyzeManifest(entry, linked, options);
      next.set(entry.id, current);
      if (stableManifest(current) !== stableManifest(previous)) changed = true;
    }
    manifests = next;
    if (!changed) break;
    if (pass === entries.size) {
      throw new Error('memo-dom: cross-module export summaries did not converge');
    }
  }

  const output: Record<string, string> = {};
  for (const entry of entries.values()) {
    const manifest = manifests.get(entry.id)!;
    const linkedImports = linkImports(entry, manifest, manifests, entries, options);
    for (const ref of manifest.imports) {
      const target = resolveModule(entry.id, ref.source, entries, options);
      if (
        target !== undefined &&
        manifests.get(target.id)?.exports[ref.imported] === undefined
      ) {
        throw new Error(
          `memo-dom: '${ref.imported}' is not a linkable state/function export of '${ref.source}'`,
        );
      }
    }
    output[entry.originalId] = compile(entry.source, {
      ...compilerOptions(options),
      moduleId: entry.id,
      linkedImports,
    });
  }
  return output;
}
