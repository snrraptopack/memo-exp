/**
 * cells.ts - SSR Phase 1.3 production lowering (proposal Option B).
 *
 * Rewrites authored module-state bindings into request-owned state-cell
 * operations for server builds (opt-in via `moduleStateCells`). The linker's
 * canonical identities (`./src/state.ts#count`) stay stable, so access-table
 * routing, computed entities, effects, and component updates are unchanged -
 * only STORAGE moves per request.
 *
 * Per module graph node, for every reactive root (`let` bindings and mutated
 * `const` stores):
 *   - the owning module emits `_MD.defineStateCell('<canonical>', default)`
 *     recording its authored default (a factory for object stores so each
 *     request instantiates fresh objects);
 *   - importing modules emit the same call without a default - ESM postorder
 *     evaluation guarantees the owner registered first;
 *   - every read site lowers to `_MD.readCell(<cell>)`;
 *   - direct rebinding writes lower to `_MD.setCell` / `_MD.updateCell`.
 *
 * Kept as-is: member mutations (`store.items.push(x)`) - the base identifier
 * still lowers to `readCell`, so they mutate this request's own instance;
 * invalidation remains caller-side `commitWrites` under unchanged canonical
 * keys. Authored declarations remain for external export consumers, but their
 * values go stale inside compiled graphs (reads/writes route through cells).
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Binding } from '@babel/traverse';
import type { Ctx } from './context';
import { generatedIdentifier, md } from './identifiers';

type ReactiveKind = 'let' | 'store';

interface CellLift {
  readonly local: string;
  readonly key: string;
  readonly kind: ReactiveKind;
  readonly cellId: string;
  readonly binding: Binding;
  readonly owned: boolean;
}

function isDeepLiteral(node: t.Node): boolean {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node)
  ) {
    return true;
  }
  if (t.isUnaryExpression(node) && node.operator === '-') {
    return isDeepLiteral(node.argument);
  }
  if (t.isObjectExpression(node)) {
    return node.properties.every((property) => {
      if (!t.isObjectProperty(property) || property.computed) return false;
      return property.value !== null && isDeepLiteral(property.value);
    });
  }
  if (t.isArrayExpression(node)) {
    return node.elements.every(
      (element) => element !== null && isDeepLiteral(element),
    );
  }
  return false;
}

function fail(path: NodePath, message: string): never {
  throw path.buildCodeFrameError(`memo-dom: ${message}`);
}

function compoundOperator(operator: string): string | null {
  switch (operator) {
    case '+=':
      return '+';
    case '-=':
      return '-';
    case '*=':
      return '*';
    case '/=':
      return '/';
    default:
      return null;
  }
}

export function liftModuleStateCells(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  if (ctx.moduleStateCells !== true) return;

  const lifts = new Map<string, CellLift>();

  for (const [local, kind] of ctx.state) {
    if (kind !== 'let' && kind !== 'store') continue;
    const key = ctx.stateKeys.get(local);
    if (key === undefined) continue;
    const binding = programPath.scope.getBinding(local);
    if (binding === undefined || binding.constantViolations === undefined) {
      continue;
    }

    const owned = binding.kind !== 'module';
    if (owned) {
      // Validate the authored default we will record.
      const declarator = binding.path;
      if (!declarator.isVariableDeclarator()) continue;
      const init = declarator.node.init ?? undefined;
      if (kind === 'store') {
        if (init === undefined || !isDeepLiteral(init)) {
          fail(
            declarator,
            `mutated store '${local}' must be initialized from a plain object/array literal to lower into request-owned state cells`,
          );
        }
      } else if (init !== undefined && !isDeepLiteral(init)) {
        fail(
          declarator,
          `module-state let '${local}' must be initialized from a literal to lower into request-owned state cells`,
        );
      }
      const reExported = binding.referencePaths.some((reference) =>
        reference.parentPath?.isExportSpecifier(),
      );
      if (reExported) {
        fail(declarator, `cannot lower re-exported module state '${local}'`);
      }
    }

    lifts.set(local, {
      local,
      key,
      kind,
      cellId: generatedIdentifier(ctx, `cell_${local}`).name,
      binding,
      owned,
    });
  }

  if (lifts.size === 0) return;

  // Drop lifted names from authored imports; the cell replaces the binding.
  // An emptied import stays as a side-effect import so ESM postorder
  // evaluation still guarantees the owning module registers its default
  // before any importer references the key.
  for (const lift of lifts.values()) {
    if (lift.owned) continue;
    const specifier = lift.binding.path;
    if (specifier.isImportSpecifier()) {
      const declaration = specifier.parentPath;
      specifier.remove();
      if (
        declaration !== null &&
        declaration.isImportDeclaration() &&
        declaration.node.specifiers.length === 0
      ) {
        declaration.replaceWith(
          t.importDeclaration([], declaration.node.source),
        );
      }
    }
  }

  // Descriptor declarations: owner records its authored default (factory for
  // object stores); importers reference the same identity with no default.
  for (const lift of lifts.values()) {
    const arguments_: t.Expression[] = [t.stringLiteral(lift.key)];
    if (lift.owned) {
      const declarator =
        lift.binding.kind !== 'module'
          ? (lift.binding.path as NodePath<t.VariableDeclarator>)
          : undefined;
      const init = declarator?.node.init ?? undefined;
      if (init !== undefined) {
        if (lift.kind === 'store') {
          arguments_.push(
            t.arrowFunctionExpression(
              [],
              t.blockStatement([t.returnStatement(t.cloneNode(init))]),
            ),
          );
        } else {
          arguments_.push(t.cloneNode(init));
        }
      }
    }
    ctx.header.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(lift.cellId),
          t.callExpression(md(ctx, 'defineStateCell'), arguments_),
        ),
      ]),
    );
  }

  const resolve = (
    path: NodePath<t.Identifier>,
  ): CellLift | undefined => {
    const lift = lifts.get(path.node.name);
    if (lift === undefined) return undefined;
    const current = path.scope.getBinding(path.node.name);
    if (current === lift.binding) return lift; // owned declaration
    // Importer case: the authored import specifier was already removed, so
    // remaining references have no scope binding of their own.
    if (!lift.owned && current === undefined) return lift;
    return undefined; // shadowed local
  };

  const isTypeContext = (path: NodePath<t.Identifier>): boolean => {
    let ancestor: NodePath | null = path.parentPath;
    while (ancestor !== null) {
      if (ancestor.node.type.startsWith('TS')) return true;
      if (ancestor.isProgram()) break;
      ancestor = ancestor.parentPath;
    }
    return false;
  };

  const readCall = (lift: CellLift): t.CallExpression =>
    t.callExpression(md(ctx, 'readCell'), [t.identifier(lift.cellId)]);

  // ---- Pass A: reads -----------------------------------------------------
  // Emitted code can reference ONE identifier node from several AST
  // positions (creation + update closures), and Babel traverses a shared
  // node only once - so iterate to a fixpoint until nothing is rewritten.
  for (let round = 0; round < 16; round++) {
    let rewrote = false;
    programPath.traverse({
      Identifier(path) {
        const lift = resolve(path);
        if (lift === undefined || isTypeContext(path)) return;

        const parent = path.parent;
        if (
          (t.isVariableDeclarator(parent) && parent.id === path.node) ||
          (t.isMemberExpression(parent) &&
            parent.property === path.node &&
            !parent.computed) ||
          t.isExportSpecifier(parent) ||
          t.isImportSpecifier(parent)
        ) {
          return;
        }

        // Write positions are handled by pass B.
        if (
          (t.isAssignmentExpression(parent) && parent.left === path.node) ||
          (t.isUpdateExpression(parent) && parent.argument === path.node)
        ) {
          return;
        }

        // Shorthand `{ count }` must expand to an explicit property.
        const propertyPath = path.parentPath;
        if (
          propertyPath.isObjectProperty() &&
          propertyPath.node.key === path.node &&
          !propertyPath.node.computed
        ) {
          if (
            propertyPath.node.shorthand &&
            propertyPath.node.value === path.node
          ) {
            propertyPath.node.shorthand = false;
            propertyPath.node.value = readCall(lift);
            rewrote = true;
          }
          // A non-computed object key is never a state read.
          return;
        }
        if (
          propertyPath.isObjectProperty() &&
          propertyPath.node.shorthand &&
          propertyPath.node.value === path.node
        ) {
          propertyPath.node.shorthand = false;
          propertyPath.node.value = readCall(lift);
          rewrote = true;
          return;
        }

        path.replaceWith(readCall(lift));
        rewrote = true;
      },
    });
    if (!rewrote) break;
  }

  // ---- Pass B: direct rebinding writes -----------------------------------
  const writeCall = (
    lift: CellLift,
    node: t.AssignmentExpression | t.UpdateExpression,
  ): t.CallExpression => {
    if (t.isAssignmentExpression(node)) {
      if (node.operator === '=') {
        return t.callExpression(md(ctx, 'setCell'), [
          t.identifier(lift.cellId),
          t.cloneNode(node.right),
        ]);
      }
      const operator = compoundOperator(node.operator);
      if (operator === null) {
        throw new Error(
          `memo-dom: unsupported compound write '${node.operator}' on module state '${lift.local}'`,
        );
      }
      return t.callExpression(md(ctx, 'updateCell'), [
        t.identifier(lift.cellId),
        t.arrowFunctionExpression(
          [t.identifier('c')],
          t.binaryExpression(
            operator as '+' | '-' | '*' | '/',
            t.identifier('c'),
            t.cloneNode(node.right),
          ),
        ),
      ]);
    }
    const delta = node.operator === '--' ? '-' : '+';
    return t.callExpression(md(ctx, 'updateCell'), [
      t.identifier(lift.cellId),
      t.arrowFunctionExpression(
        [t.identifier('c')],
        t.binaryExpression(delta, t.identifier('c'), t.numericLiteral(1)),
      ),
    ]);
  };

  // Shared-node consideration as in pass A: iterate to a fixpoint.
  for (let round = 0; round < 16; round++) {
    let rewrote = false;
    programPath.traverse({
      AssignmentExpression(path) {
        const left = path.node.left;
        if (!t.isIdentifier(left)) {
          return; // member writes mutate the request's own instance
        }
        const leftPath = path.get('left');
        const lift = resolve(leftPath as unknown as NodePath<t.Identifier>);
        if (lift === undefined) return;
        if (path.parentPath.isExpressionStatement()) {
          path.replaceWith(writeCall(lift, path.node));
          rewrote = true;
        } else {
          throw path.buildCodeFrameError(
            `memo-dom: module-state write '${lift.local}' must be a statement; value-producing assignments cannot lower to state cells`,
          );
        }
      },
      UpdateExpression(path) {
        const argument = path.node.argument;
        if (!t.isIdentifier(argument)) return;
        const argumentPath = path.get('argument');
        const lift = resolve(
          argumentPath as unknown as NodePath<t.Identifier>,
        );
        if (lift === undefined) return;
        if (path.parentPath.isExpressionStatement()) {
          path.replaceWith(writeCall(lift, path.node));
          rewrote = true;
        } else {
          throw path.buildCodeFrameError(
            `memo-dom: module-state update '${lift.local}' must be a statement; its produced value cannot lower to state cells`,
          );
        }
      },
    });
    if (!rewrote) break;
  }
}
