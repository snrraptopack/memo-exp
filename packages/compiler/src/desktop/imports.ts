/** Link compiled component identities without invoking a target's emitter. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { parseWithEstreeFrontendOrThrow, type EstreeFrontend } from '../ast/parser';
import { normalizeEstreeDialect } from '../ast/normalize';
import { normalizeComponentDeclarations } from '../components/declarations';
import { discoverComponentExports } from '../components/manifest';
import { exportedLocals } from '../linking/module-exports';
import type { LinkedComponentImport, ProgramPath } from '../context/model';
import { compilerError } from '../errors';

export interface DesktopModuleSource { moduleId: string; source: string }
export type DesktopModuleReader = (specifier: string, importer: string) => DesktopModuleSource | undefined;

export function desktopComponentImports(program: t.Program, moduleId: string, frontend: EstreeFrontend, read?: DesktopModuleReader): Record<string, LinkedComponentImport> {
  const cache = new Map<string, { program: t.Program; components: ReturnType<typeof discoverComponentExports>; exports: Map<string, string> }>();
  const visiting = new Set<string>();
  const resolveExport = (specifier: string, importer: string, exported: string): LinkedComponentImport | undefined => {
    const module = read?.(specifier, importer);
    if (!module) return undefined;
    const key = `${module.moduleId}\0${exported}`;
    if (visiting.has(key)) throw compilerError('memo-dom desktop: cyclic component re-export', moduleId, program);
    visiting.add(key);
    try {
      let facts = cache.get(module.moduleId);
      if (!facts) {
        const parsed = parseWithEstreeFrontendOrThrow(frontend, module.source, { filename: module.moduleId, sourceType: 'module' });
        const ast = parsed.program as t.Program;
        normalizeEstreeDialect(ast);
        const path: ProgramPath = { node: ast, buildCodeFrameError: (message, at) => compilerError(message, module.moduleId, at) };
        normalizeComponentDeclarations(path);
        facts = { program: ast, components: discoverComponentExports(ast, module.moduleId), exports: exportedLocals(ast) };
        cache.set(module.moduleId, facts);
      }
      const local = facts.exports.get(exported);
      if (!local) return undefined;
      const component = facts.components.get(local);
      if (component) return { type: 'component', ...component };
      for (const statement of facts.program.body) {
        if (!b.isImportDeclaration(statement) || statement.importKind === 'type') continue;
        const binding = statement.specifiers.find(binding => binding.local?.name === local);
        const name = binding && importedName(binding);
        if (name) return resolveExport(statement.source.value, module.moduleId, name);
      }
      return undefined;
    } finally { visiting.delete(key); }
  };
  const linked: Record<string, LinkedComponentImport> = Object.create(null);
  for (const statement of program.body) {
    if (!b.isImportDeclaration(statement) || statement.importKind === 'type') continue;
    for (const binding of statement.specifiers) {
      const name = importedName(binding);
      if (!name) continue;
      const component = resolveExport(statement.source.value, moduleId, name);
      if (component) linked[binding.local.name] = component;
    }
  }
  return linked;
}

function importedName(binding: t.ImportDeclaration['specifiers'][number]): string | undefined {
  if (b.isImportDefaultSpecifier(binding)) return 'default';
  if (!b.isImportSpecifier(binding) || binding.importKind === 'type') return undefined;
  return b.isStringLiteral(binding.imported) ? binding.imported.value : binding.imported.name;
}
