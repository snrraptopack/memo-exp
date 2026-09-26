/** Resolve linked star exports and normalize named reexports for the linker. */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { cloneNode, extractPatternIdentifiers, walkAst, type BaseNode } from '../ast';
import { compilerError } from '../errors';
import type { CompileModulesOptions, ModuleEntry } from './model';
import { resolveModule } from './resolution';

interface ExportRule {
  origin?: string;
  target?: ModuleEntry;
  imported?: string;
}

interface StarSource {
  statement: t.ExportAllDeclaration;
  target?: ModuleEntry;
}

/** Resolve the names and ESM binding identities of linked star exports. */
export function expandStarReexports(
  entries: ReadonlyMap<string, ModuleEntry>, options: CompileModulesOptions,
): void {
  if (![...entries.values()].some((entry) => entry.ast.body.some((statement) =>
    statement.type === 'ExportAllDeclaration'))) return;
  const rules = new Map<ModuleEntry, Map<string, ExportRule>>();
  const stars = new Map<ModuleEntry, StarSource[]>();
  const nameOf = (node: t.Identifier | t.StringLiteral): string =>
    ast.isIdentifier(node) ? node.name : node.value;
  for (const entry of entries.values()) {
    const explicit = new Map<string, ExportRule>();
    const starSources: StarSource[] = [];
    const importedBinding = (local: string): ExportRule => {
      for (const statement of entry.ast.body) {
        if (!ast.isImportDeclaration(statement) || !ast.isStringLiteral(statement.source)) continue;
        for (const specifier of statement.specifiers) {
          if (specifier.local.name !== local) continue;
          const target = resolveModule(entry.id, statement.source.value, entries, options);
          if (target === undefined) break;
          if (ast.isImportSpecifier(specifier)) {
            return { target, imported: nameOf(specifier.imported) };
          }
          if (ast.isImportDefaultSpecifier(specifier)) return { target, imported: 'default' };
        }
      }
      return { origin: `${entry.id}#${local}` };
    };
    for (const statement of entry.ast.body) {
      if (statement.type === 'ExportAllDeclaration' && statement.exported === null &&
          ast.isStringLiteral(statement.source) &&
          (statement as t.ExportAllDeclaration & { exportKind?: string }).exportKind !== 'type') {
        starSources.push({ statement, target: resolveModule(entry.id, statement.source.value,
          entries, options) });
        continue;
      }
      if (ast.isExportDefaultDeclaration(statement)) {
        explicit.set('default', ast.isIdentifier(statement.declaration)
          ? importedBinding(statement.declaration.name) : { origin: `${entry.id}#default` });
        continue;
      }
      if (!ast.isExportNamedDeclaration(statement) ||
          (statement as t.ExportNamedDeclaration & { exportKind?: string }).exportKind === 'type') continue;
      const declaration = statement.declaration;
      if ((ast.isFunctionDeclaration(declaration) || ast.isClassDeclaration(declaration)) &&
          declaration.id !== null) {
        explicit.set(declaration.id.name, { origin: `${entry.id}#${declaration.id.name}` });
      } else if (ast.isVariableDeclaration(declaration)) {
        for (const item of declaration.declarations) {
          for (const identifier of extractPatternIdentifiers(item.id as BaseNode)) {
            explicit.set(identifier.name, { origin: `${entry.id}#${identifier.name}` });
          }
        }
      }
      for (const specifier of statement.specifiers) {
        if (!ast.isExportSpecifier(specifier) ||
            (specifier as t.ExportSpecifier & { exportKind?: string }).exportKind === 'type') continue;
        const exported = nameOf(specifier.exported);
        const local = nameOf(specifier.local);
        if (statement.source !== null && ast.isStringLiteral(statement.source)) {
          const target = resolveModule(entry.id, statement.source.value, entries, options);
          explicit.set(exported, target === undefined
            ? { origin: `${entry.id}#${exported}` } : { target, imported: local });
        } else {
          explicit.set(exported, importedBinding(local));
        }
      }
    }
    rules.set(entry, explicit);
    stars.set(entry, starSources);
  }

  let origins = new Map<ModuleEntry, Map<string, Set<string>>>();
  for (const entry of entries.values()) origins.set(entry, new Map());
  while (true) {
    const next = new Map<ModuleEntry, Map<string, Set<string>>>();
    let changed = false;
    for (const entry of entries.values()) {
      const explicit = rules.get(entry)!;
      const found = new Map<string, Set<string>>();
      for (const [name, rule] of explicit) {
        found.set(name, rule.origin === undefined
          ? new Set(origins.get(rule.target!)?.get(rule.imported!) ?? [])
          : new Set([rule.origin]));
      }
      for (const star of stars.get(entry)!) {
        if (star.target === undefined) continue;
        for (const [name, sourceOrigins] of origins.get(star.target)!) {
          if (name === 'default' || explicit.has(name)) continue;
          const combined = found.get(name) ?? new Set<string>();
          for (const origin of sourceOrigins) combined.add(origin);
          found.set(name, combined);
        }
      }
      const previous = origins.get(entry)!;
      if (found.size !== previous.size || [...found].some(([name, values]) =>
        values.size !== previous.get(name)?.size ||
        [...values].some((value) => !previous.get(name)?.has(value)))) changed = true;
      next.set(entry, found);
    }
    origins = next;
    if (!changed) break;
  }

  for (const entry of entries.values()) {
    for (const statement of entry.ast.body) {
      if (!ast.isImportDeclaration(statement) || !ast.isStringLiteral(statement.source)) continue;
      if ((statement as t.ImportDeclaration & { importKind?: string }).importKind === 'type') continue;
      const target = resolveModule(entry.id, statement.source.value, entries, options);
      if (target === undefined) continue;
      for (const specifier of statement.specifiers) {
        if (!ast.isImportSpecifier(specifier) ||
            (specifier as t.ImportSpecifier & { importKind?: string }).importKind === 'type') continue;
        const imported = nameOf(specifier.imported);
        if ((origins.get(target)?.get(imported)?.size ?? 0) > 1) {
          throw compilerError(`memo-dom: ambiguous star export '${imported}'`, entry.id,
            specifier as BaseNode);
        }
      }
    }
  }

  for (const entry of entries.values()) {
    const explicit = rules.get(entry)!;
    const groups = new Map<t.ExportAllDeclaration, string[]>();
    for (const [name, values] of origins.get(entry)!) {
      if (name === 'default' || explicit.has(name) || values.size !== 1) continue;
      const origin = values.values().next().value;
      if (origin === undefined) continue;
      for (const star of stars.get(entry)!) {
        if (star.target === undefined || !origins.get(star.target)?.get(name)?.has(origin)) continue;
        const names = groups.get(star.statement) ?? [];
        names.push(name);
        groups.set(star.statement, names);
        break;
      }
    }
    entry.ast.body = entry.ast.body.flatMap((statement) => {
      if (statement.type === 'ExportAllDeclaration' &&
          (statement as t.ExportAllDeclaration & { exportKind?: string }).exportKind === 'type') return [];
      if (statement.type !== 'ExportAllDeclaration' || statement.exported !== null ||
          !ast.isStringLiteral(statement.source) ||
          stars.get(entry)?.find((star) => star.statement === statement)?.target === undefined) {
        return [statement];
      }
      const source = cloneNode(statement.source as BaseNode, true) as t.StringLiteral;
      const names = groups.get(statement) ?? [];
      return names.length === 0 ? [ast.importDeclaration([], source)] : [
        ast.exportNamedDeclaration(null, names.sort().map((name) =>
          ast.exportSpecifier(ast.identifier(name))), source),
      ];
    });
  }
}

export function normalizeNamedReexports(program: t.Program): void {
  if (!program.body.some((statement) =>
    ast.isExportNamedDeclaration(statement) && statement.source !== null)) return;
  const occupied = new Set<string>();
  walkAst(program as BaseNode, { enter(node) {
    if (ast.isIdentifier(node)) occupied.add(node.name);
  } });
  let serial = 0;
  const fresh = (): string => {
    let name: string;
    do { name = `__mmdReexport${serial++}`; } while (occupied.has(name));
    occupied.add(name);
    return name;
  };
  const body: t.Statement[] = [];
  for (const statement of program.body) {
    if (!ast.isExportNamedDeclaration(statement) || statement.source === null) {
      body.push(statement);
      continue;
    }
    if ((statement as t.ExportNamedDeclaration & { exportKind?: string }).exportKind === 'type') {
      continue;
    }
    const imports: t.ImportSpecifier[] = [];
    const exports: t.ExportSpecifier[] = [];
    for (const specifier of statement.specifiers) {
      if ((specifier as t.ExportSpecifier & { exportKind?: string }).exportKind === 'type') {
        continue;
      }
      if (!ast.isExportSpecifier(specifier)) {
        throw new Error('memo-dom: named reexports require statically named exports');
      }
      const local = ast.identifier(fresh());
      imports.push(ast.importSpecifier(ast.identifier(local.name),
        cloneNode(specifier.local as BaseNode, true) as t.Identifier));
      exports.push(ast.exportSpecifier(ast.identifier(local.name),
        cloneNode(specifier.exported as BaseNode, true) as t.Identifier | t.StringLiteral));
    }
    if (imports.length === 0) continue;
    body.push(ast.importDeclaration(imports,
      cloneNode(statement.source as BaseNode, true) as t.StringLiteral));
    body.push(ast.exportNamedDeclaration(null, exports));
  }
  program.body = body;
}
