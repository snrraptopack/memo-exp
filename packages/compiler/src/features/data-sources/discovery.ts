/** Import discovery and early validation for compiler-transparent sources. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  walkAst,
  type BaseNode,
  type Binding,
  type Identifier,
} from '../../ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  unwrapTypeExpression,
  type Ctx,
} from '../../context';

const COLORLESS_DESTRUCTURING_ERROR =
  'memo-dom: [MMD-S004] Colorless server function and $fetch sources cannot be destructured. Destructuring copies values before the source settles. Bind the source and read properties at the use site, or destructure a settled plain value.';

function importedName(specifier: t.ImportSpecifier): string {
  return astFactory.isIdentifier(specifier.imported)
    ? specifier.imported.name
    : specifier.imported.value;
}

function importedProgramBinding(
  ctx: Ctx,
  component: BaseNode,
  name: string,
): Binding | undefined {
  const binding = astBindingAt(ctx, component, name);
  return binding?.kind === 'import' ? binding : undefined;
}

export function isCallToImported(
  ctx: Ctx,
  component: BaseNode,
  call: t.Expression | null | undefined,
  names: ReadonlySet<string>,
): boolean {
  if (
    !astFactory.isCallExpression(call) ||
    !astFactory.isIdentifier(call.callee) ||
    !names.has(call.callee.name)
  ) {
    return false;
  }
  return importedProgramBinding(ctx, component, call.callee.name) !== undefined;
}

/** Resolve provider metadata to local import aliases before module analysis. */
export function scanTransparentSourceImports(
  ctx: Ctx,
  programPath: { node: t.Program },
): void {
  const definitions = new Map(
    ctx.transparentAsyncSources.map((definition) => [
      definition.module,
      definition,
    ]),
  );
  for (const statement of programPath.node.body) {
    if (!astFactory.isImportDeclaration(statement)) continue;
    const definition = definitions.get(statement.source.value);
    if (definition === undefined) continue;
    for (const specifier of statement.specifiers) {
      if (!astFactory.isImportSpecifier(specifier)) continue;
      const name = importedName(specifier);
      if (name === definition.source) {
        ctx.transparentSourceFactories.add(specifier.local.name);
        ctx.transparentProviderFactories.add(specifier.local.name);
        ctx.importedFunctions.set(specifier.local.name, {
          reads: new Set(),
          writes: new Set(),
          boundedWrites: new Set(),
          parameterWrites: [],
          unbounded: false,
        });
      }
      if (name === definition.track || name === definition.operations) {
        ctx.transparentSourcePassthroughs.add(specifier.local.name);
        if (name === definition.track) {
          ctx.transparentTrackFactories.add(specifier.local.name);
        }
        ctx.importedFunctions.set(specifier.local.name, {
          reads: new Set(),
          writes: new Set(),
          boundedWrites: new Set(),
          parameterWrites: [],
          unbounded: false,
        });
      }
      if (name === definition.group) {
        ctx.transparentGroups.add(specifier.local.name);
      }
      if (name === definition.pending) {
        ctx.transparentPendingPolicies.add(specifier.local.name);
      }
      if (name === definition.error) {
        ctx.transparentErrorPolicies.add(specifier.local.name);
      }
    }
  }
}

function isDestructuringPattern(node: BaseNode | null): node is BaseNode {
  return node?.type === 'ObjectPattern' || node?.type === 'ArrayPattern';
}

/** Reject eager destructuring before transparent-source lowering mutates it. */
export function rejectTransparentSourceDestructuring(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): void {
  refreshAstAnalysis(ctx, programPath.node);
  const sourceBindings = new Set<Binding>();

  const sourceExpression = (candidate: BaseNode | null): boolean => {
    if (candidate === null) return false;
    const expression = unwrapTypeExpression(candidate);
    if (expression.type === 'Identifier') {
      const identifier = expression as Identifier;
      const binding = astBindingAt(ctx, identifier, identifier.name);
      return binding !== undefined && (
        sourceBindings.has(binding) ||
        (binding.kind === 'import' &&
          ctx.transparentModuleSources.has(identifier.name))
      );
    }
    if (expression.type !== 'CallExpression') return false;
    return isCallToImported(
      ctx,
      expression,
      expression as unknown as t.CallExpression,
      ctx.transparentSourceFactories,
    );
  };

  let changed = true;
  while (changed) {
    changed = false;
    walkAst(programPath.node as unknown as BaseNode, {
      enter(node) {
        if (node.type !== 'VariableDeclarator') return;
        const id = childNode(node, 'id');
        const init = childNode(node, 'init');
        if (id?.type !== 'Identifier' || !sourceExpression(init)) return;
        const identifier = id as Identifier;
        const binding = astBindingAt(ctx, identifier, identifier.name);
        if (binding !== undefined && !sourceBindings.has(binding)) {
          sourceBindings.add(binding);
          changed = true;
        }
      },
    });
  }

  walkAst(programPath.node as unknown as BaseNode, {
    enter(node) {
      const pair = node.type === 'VariableDeclarator'
        ? ['id', 'init'] as const
        : node.type === 'AssignmentExpression' ||
            node.type === 'AssignmentPattern'
          ? ['left', 'right'] as const
          : null;
      if (pair === null) return;
      const pattern = childNode(node, pair[0]);
      if (
        isDestructuringPattern(pattern) &&
        sourceExpression(childNode(node, pair[1]))
      ) {
        throw programPath.buildCodeFrameError(
          COLORLESS_DESTRUCTURING_ERROR,
          pattern as unknown as t.Node,
        );
      }
    },
  });
}
