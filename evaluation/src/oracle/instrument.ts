import { parse } from '@babel/parser';
import _generate from '@babel/generator';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { resolveModuleId } from '../shared';

const traverse: typeof _traverse =
  (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;
const generate: typeof _generate =
  (_generate as unknown as { default?: typeof _generate }).default ?? _generate;

interface BindingFact {
  key: string;
  object: boolean;
  computed: boolean;
}

interface ModuleAnalysis {
  ast: ReturnType<typeof parse>;
  bindings: Map<string, BindingFact>;
  imports: Map<string, { source: string; imported: string }>;
}

export interface InstrumentedProgram {
  modules: Record<string, string>;
  computationKeys: Record<string, string>;
}

const MUTATING_METHODS = new Set([
  'copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift',
]);

export function instrumentProgram(
  modules: Readonly<Record<string, string>>,
): InstrumentedProgram {
  const analyses = discoverBindings(modules);
  const computationKeys: Record<string, string> = {};
  const output: Record<string, string> = {};

  for (const [moduleId, analysis] of analyses) {
    const ast = analysis.ast;
    const registrationStatements: t.Statement[] = [];
    const computations: t.ObjectExpression[] = [];

    for (const statement of ast.program.body) {
      const declaration = t.isExportNamedDeclaration(statement)
        ? statement.declaration
        : statement;
      if (!t.isVariableDeclaration(declaration)) continue;
      for (const item of declaration.declarations) {
        if (!t.isIdentifier(item.id) || item.init === null) continue;
        const fact = analysis.bindings.get(item.id.name);
        if (fact === undefined) continue;
        if (fact.computed) {
          const initializer = item.init as t.Expression;
          declaration.kind = 'let';
          item.init = null;
          const entityId = computedEntityId(moduleId, item.id.name);
          computationKeys[entityId] = fact.key;
          computations.push(
            t.objectExpression([
              t.objectProperty(t.identifier('id'), t.stringLiteral(entityId)),
              t.objectProperty(t.identifier('key'), t.stringLiteral(fact.key)),
              t.objectProperty(
                t.identifier('run'),
                t.arrowFunctionExpression(
                  [],
                  t.assignmentExpression('=', t.identifier(item.id.name), initializer),
                ),
              ),
            ]),
          );
        } else if (fact.object) {
          registrationStatements.push(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(t.identifier('__oracle'), t.identifier('registerObject')),
                [t.stringLiteral(fact.key), t.identifier(item.id.name)],
              ),
            ),
          );
        }
      }
    }

    ast.program.body.unshift(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('__oracle'),
          t.memberExpression(
            t.identifier('globalThis'),
            t.identifier('__MEMO_EVAL_ORACLE__'),
          ),
        ),
      ]),
    );
    ast.program.body.push(...registrationStatements);
    ast.program.body.push(
      t.exportNamedDeclaration(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('__oracleComputations'),
            t.arrayExpression(computations),
          ),
        ]),
      ),
    );

    instrumentWrites(ast, analysis);
    instrumentReads(ast, analysis);
    output[moduleId] = generate(ast, { comments: false }).code;
  }

  return { modules: output, computationKeys };
}

function discoverBindings(
  modules: Readonly<Record<string, string>>,
): Map<string, ModuleAnalysis> {
  const analyses = new Map<string, ModuleAnalysis>();
  for (const [moduleId, source] of Object.entries(modules)) {
    const ast = parse(source, {
      sourceType: 'module',
      sourceFilename: moduleId,
      plugins: ['typescript', 'jsx'],
    });
    const bindings = new Map<string, BindingFact>();
    const imports = new Map<string, { source: string; imported: string }>();
    for (const statement of ast.program.body) {
      if (t.isImportDeclaration(statement)) {
        const target = resolveModuleId(moduleId, statement.source.value, modules);
        if (target === undefined) continue;
        for (const specifier of statement.specifiers) {
          if (!t.isImportSpecifier(specifier)) continue;
          imports.set(specifier.local.name, {
            source: target,
            imported: t.isIdentifier(specifier.imported)
              ? specifier.imported.name
              : specifier.imported.value,
          });
        }
        continue;
      }
      const declaration = t.isExportNamedDeclaration(statement)
        ? statement.declaration
        : statement;
      if (!t.isVariableDeclaration(declaration)) continue;
      for (const item of declaration.declarations) {
        if (!t.isIdentifier(item.id) || item.init === null) continue;
        if (declaration.kind === 'let' || declaration.kind === 'var') {
          bindings.set(item.id.name, {
            key: `${moduleId}#${item.id.name}`,
            object: t.isObjectExpression(item.init) || t.isArrayExpression(item.init),
            computed: false,
          });
        } else if (
          t.isObjectExpression(item.init) ||
          t.isArrayExpression(item.init) ||
          t.isNewExpression(item.init)
        ) {
          bindings.set(item.id.name, {
            key: `${moduleId}#${item.id.name}`,
            object: true,
            computed: false,
          });
        }
      }
    }
    analyses.set(moduleId, { ast, bindings, imports });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [moduleId, analysis] of analyses) {
      for (const [local, imported] of analysis.imports) {
        const fact = analyses.get(imported.source)?.bindings.get(imported.imported);
        if (fact !== undefined && !analysis.bindings.has(local)) {
          analysis.bindings.set(local, fact);
          changed = true;
        }
      }
      for (const statement of analysis.ast.program.body) {
        const declaration = t.isExportNamedDeclaration(statement)
          ? statement.declaration
          : statement;
        if (!t.isVariableDeclaration(declaration) || declaration.kind !== 'const') continue;
        for (const item of declaration.declarations) {
          if (!t.isIdentifier(item.id) || item.init == null || analysis.bindings.has(item.id.name)) continue;
          if (expressionReferencesBinding(item.init, analysis.bindings)) {
            analysis.bindings.set(item.id.name, {
              key: `${moduleId}#${item.id.name}`,
              object: false,
              computed: true,
            });
            changed = true;
          }
        }
      }
    }
  }
  return analyses;
}

function expressionReferencesBinding(
  expression: t.Expression,
  bindings: ReadonlyMap<string, BindingFact>,
): boolean {
  let found = false;
  const file = t.file(t.program([t.expressionStatement(t.cloneNode(expression, true))]));
  traverse(file, {
    Identifier(path) {
      if (bindings.has(path.node.name) && isReadReference(path)) {
        found = true;
        path.stop();
      }
    },
  });
  return found;
}

function instrumentWrites(
  ast: ReturnType<typeof parse>,
  analysis: ModuleAnalysis,
): void {
  traverse(ast, {
    AssignmentExpression(path) {
      if (path.findParent((parent) => parent.isAssignmentExpression() && parent.node === path.node)) return;
      const trace = writeTrace(path, path.node.left, analysis);
      if (trace === null) return;
      path.replaceWith(t.sequenceExpression([trace, t.cloneNode(path.node, true)]));
      path.skip();
    },
    UpdateExpression(path) {
      const trace = writeTrace(path, path.node.argument, analysis);
      if (trace === null) return;
      path.replaceWith(t.sequenceExpression([trace, t.cloneNode(path.node, true)]));
      path.skip();
    },
    UnaryExpression(path) {
      if (path.node.operator !== 'delete') return;
      const trace = writeTrace(path, path.node.argument, analysis);
      if (trace === null) return;
      path.replaceWith(t.sequenceExpression([trace, t.cloneNode(path.node, true)]));
      path.skip();
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (!t.isMemberExpression(callee)) return;
      const method = !callee.computed && t.isIdentifier(callee.property)
        ? callee.property.name
        : t.isStringLiteral(callee.property)
          ? callee.property.value
          : null;
      if (method === null || !MUTATING_METHODS.has(method) || t.isSuper(callee.object)) return;
      const trace = writeTrace(path, callee.object, analysis);
      if (trace === null) return;
      path.replaceWith(t.sequenceExpression([trace, t.cloneNode(path.node, true)]));
      path.skip();
    },
  });
}

function writeTrace(
  path: NodePath,
  target: t.LVal | t.Expression,
  analysis: ModuleAnalysis,
): t.CallExpression | null {
  if (t.isIdentifier(target)) {
    const fact = bindingFor(path, target.name, analysis);
    if (fact !== undefined) return oracleCall('write', [t.stringLiteral(fact.key)]);
    return null;
  }
  if (!t.isMemberExpression(target) || t.isSuper(target.object)) return null;
  const chain = memberChain(target);
  if (chain === null) return null;
  const fact = bindingFor(path, chain.root.name, analysis);
  if (fact !== undefined) {
    if (fact.object) {
      return oracleCall('writeObject', [t.identifier(chain.root.name), t.stringLiteral(chain.path)]);
    }
    return oracleCall('write', [t.stringLiteral(chain.path === '' ? fact.key : `${fact.key}.${chain.path}`)]);
  }
  if (parameterIndex(path, chain.root.name) !== null) {
    return oracleCall('writeObject', [t.identifier(chain.root.name), t.stringLiteral(chain.path)]);
  }
  return null;
}

function instrumentReads(
  ast: ReturnType<typeof parse>,
  analysis: ModuleAnalysis,
): void {
  traverse(ast, {
    MemberExpression(path) {
      if (!isReadReference(path)) return;
      if (path.parentPath.isMemberExpression() && path.parentPath.node.object === path.node) return;
      const chain = memberChain(path.node);
      if (chain === null) return;
      const fact = bindingFor(path, chain.root.name, analysis);
      if (fact === undefined) return;
      const original = t.cloneNode(path.node, true);
      const call = fact.object
        ? oracleCall('readObject', [t.identifier(chain.root.name), t.stringLiteral(chain.path), original])
        : oracleCall('read', [
            t.stringLiteral(chain.path === '' ? fact.key : `${fact.key}.${chain.path}`),
            original,
          ]);
      path.replaceWith(call);
      path.skip();
    },
    Identifier(path) {
      if (!isReadReference(path)) return;
      if (path.parentPath.isMemberExpression() && path.parentPath.node.object === path.node) return;
      if (path.node.name === '__oracle') return;
      const fact = bindingFor(path, path.node.name, analysis);
      if (fact === undefined || fact.object) return;
      path.replaceWith(
        oracleCall('read', [t.stringLiteral(fact.key), t.identifier(path.node.name)]),
      );
      path.skip();
    },
  });
}

function bindingFor(
  path: NodePath,
  name: string,
  analysis: ModuleAnalysis,
): BindingFact | undefined {
  const fact = analysis.bindings.get(name);
  if (fact === undefined) return undefined;
  const binding = path.scope.getBinding(name);
  return binding === undefined || binding.scope.path.isProgram() ? fact : undefined;
}

function memberChain(node: t.MemberExpression): { root: t.Identifier; path: string } | null {
  const parts: string[] = [];
  let current: t.Expression = node;
  while (t.isMemberExpression(current)) {
    if (current.computed) {
      if (t.isStringLiteral(current.property) || t.isNumericLiteral(current.property)) {
        parts.unshift(String(current.property.value));
      } else {
        return null;
      }
    } else if (t.isIdentifier(current.property)) {
      parts.unshift(current.property.name);
    } else {
      return null;
    }
    if (t.isSuper(current.object)) return null;
    current = current.object;
  }
  return t.isIdentifier(current) ? { root: current, path: parts.join('.') } : null;
}

function parameterIndex(path: NodePath, name: string): number | null {
  const fn = path.getFunctionParent();
  if (fn === null) return null;
  const index = fn.node.params.findIndex((parameter) => t.isIdentifier(parameter, { name }));
  return index < 0 ? null : index;
}

function isReadReference(path: NodePath): boolean {
  if (!path.isReferenced()) return false;
  const parent = path.parentPath;
  if (parent.isAssignmentExpression() && parent.node.left === path.node) return false;
  if (parent.isUpdateExpression() && parent.node.argument === path.node) return false;
  if (parent.isUnaryExpression({ operator: 'delete' }) && parent.node.argument === path.node) return false;
  if (parent.isCallExpression() && parent.node.callee === path.node) return false;
  return true;
}

function oracleCall(name: string, args: t.Expression[]): t.CallExpression {
  return t.callExpression(
    t.memberExpression(t.identifier('__oracle'), t.identifier(name)),
    args,
  );
}

function computedEntityId(moduleId: string, binding: string): string {
  return `App/$computed/${encodeURIComponent(moduleId)}#${binding}`;
}
