/** Import discovery and early validation for compiler-transparent sources. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  cloneNode,
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
import { generatedIdentifier } from '../../identifiers';

const COLORLESS_DESTRUCTURING_ERROR =
  'memo-dom: [MMD-S004] Colorless server function and $fetch sources cannot be destructured. Destructuring copies values before the source settles. Bind the source and read properties at the use site, or destructure a settled plain value.';

const UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR =
  'memo-dom: [MMD-S004] This colorless-source destructuring form cannot be kept reactive. Use a function-local const declaration without object rest, or read properties from the source directly.';

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

/**
 * Lower function-local source destructuring to member derivations before
 * ordinary instance analysis. `const { name: label } = user` becomes the
 * reactive equivalent of `const label = user.name`; no payload is copied
 * while the transparent source is still pending.
 */
export function normalizeTransparentSourceDestructuring(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): void {
  refreshAstAnalysis(ctx, programPath.node);
  const analysis = ctx.astAnalysis!;
  const sourceBindings = new Set<Binding>();
  const supportedSourceBindings = new Set<Binding>();
  const sourceOrigins = new Map<Binding, t.Identifier>();
  const componentNodes = new Set(
    [...ctx.compPaths.values()].map(path => path.node as unknown as BaseNode),
  );

  const isDirectComponentDeclaration = (node: BaseNode): boolean => {
    const declaration = analysis.parentByNode.get(node);
    if (declaration?.type !== 'VariableDeclaration') return false;
    const body = analysis.parentByNode.get(declaration);
    if (body?.type !== 'BlockStatement') return false;
    const owner = analysis.parentByNode.get(body);
    return owner !== undefined && owner !== null && componentNodes.has(owner);
  };

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
          if (init?.type === 'Identifier') {
            const initIdentifier = init as Identifier;
            const sourceBinding = astBindingAt(
              ctx,
              initIdentifier,
              initIdentifier.name,
            );
            sourceOrigins.set(
              binding,
              sourceBinding === undefined
                ? astFactory.identifier(initIdentifier.name)
                : sourceOrigins.get(sourceBinding) ??
                  astFactory.identifier(initIdentifier.name),
            );
            if (
              sourceBinding !== undefined && (
                supportedSourceBindings.has(sourceBinding) ||
                (sourceBinding.kind === 'import' &&
                  ctx.transparentModuleSources.has(initIdentifier.name))
              )
            ) {
              supportedSourceBindings.add(binding);
            }
          } else {
            sourceOrigins.set(binding, astFactory.identifier(identifier.name));
            if (isDirectComponentDeclaration(node)) {
              supportedSourceBindings.add(binding);
            }
          }
          changed = true;
        }
      },
    });
  }

  const insideComponent = (node: BaseNode): boolean => {
    let current: BaseNode | null = node;
    while (current !== null) {
      if (componentNodes.has(current)) return true;
      current = analysis.parentByNode.get(current) ?? null;
    }
    return false;
  };
  const access = (
    object: t.Expression,
    property: t.Expression,
    computed: boolean,
  ): t.MemberExpression => astFactory.memberExpression(
    cloneNode(object),
    cloneNode(property),
    computed,
  );
  const lowerPattern = (
    pattern: t.LVal,
    value: t.Expression,
    declarations: t.VariableDeclarator[],
  ): void => {
    if (astFactory.isIdentifier(pattern)) {
      declarations.push(astFactory.variableDeclarator(pattern, value));
      return;
    }
    if (astFactory.isAssignmentPattern(pattern)) {
      const cache = generatedIdentifier(ctx, 'destructuredValue');
      declarations.push(astFactory.variableDeclarator(cache, value));
      lowerPattern(
        pattern.left as t.LVal,
        astFactory.conditionalExpression(
          astFactory.binaryExpression(
            '===',
            astFactory.identifier(cache.name),
            astFactory.identifier('undefined'),
          ),
          pattern.right,
          astFactory.identifier(cache.name),
        ),
        declarations,
      );
      return;
    }
    if (astFactory.isArrayPattern(pattern)) {
      pattern.elements.forEach((element, index) => {
        if (element === null) return;
        if (astFactory.isRestElement(element)) {
          lowerPattern(
            element.argument as t.LVal,
            astFactory.callExpression(
              access(value, astFactory.identifier('slice'), false),
              [astFactory.numericLiteral(index)],
            ),
            declarations,
          );
          return;
        }
        lowerPattern(
          element as t.LVal,
          access(value, astFactory.numericLiteral(index), true),
          declarations,
        );
      });
      return;
    }
    if (!astFactory.isObjectPattern(pattern)) {
      throw programPath.buildCodeFrameError(
        UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR,
        pattern,
      );
    }
    for (const property of pattern.properties) {
      if (astFactory.isRestElement(property)) {
        throw programPath.buildCodeFrameError(
          UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR,
          property,
        );
      }
      const propertyExpression = property.computed
        ? property.key as t.Expression
        : astFactory.isIdentifier(property.key)
          ? astFactory.identifier(property.key.name)
          : astFactory.isStringLiteral(property.key) ||
              astFactory.isNumericLiteral(property.key)
            ? property.key
            : null;
      if (propertyExpression === null) {
        throw programPath.buildCodeFrameError(
          UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR,
          property,
        );
      }
      lowerPattern(
        property.value as t.LVal,
        access(value, propertyExpression, property.computed),
        declarations,
      );
    }
  };

  walkAst(programPath.node as unknown as BaseNode, {
    enter(node) {
      const pair = node.type === 'AssignmentExpression' ||
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

  walkAst(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type !== 'VariableDeclaration') return;
      const declaration = node as unknown as t.VariableDeclaration;
      const expanded: t.VariableDeclarator[] = [];
      let lowered = false;
      for (const declarator of declaration.declarations) {
        if (
          (!astFactory.isObjectPattern(declarator.id) &&
            !astFactory.isArrayPattern(declarator.id)) ||
          declarator.init === null ||
          !sourceExpression(declarator.init as unknown as BaseNode)
        ) {
          expanded.push(declarator);
          continue;
        }
        if (!insideComponent(node)) {
          throw programPath.buildCodeFrameError(
            COLORLESS_DESTRUCTURING_ERROR,
            declarator.id,
          );
        }
        if (astFactory.isIdentifier(declarator.init)) {
          const binding = astBindingAt(
            ctx,
            declarator.init as unknown as BaseNode,
            declarator.init.name,
          );
          const supported = binding !== undefined && (
            supportedSourceBindings.has(binding) ||
            (binding.kind === 'import' &&
              ctx.transparentModuleSources.has(declarator.init.name))
          );
          if (!supported) {
            throw programPath.buildCodeFrameError(
              UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR,
              declarator.id,
            );
          }
        } else if (!isDirectComponentDeclaration(node)) {
          throw programPath.buildCodeFrameError(
            UNSUPPORTED_COLORLESS_DESTRUCTURING_ERROR,
            declarator.id,
          );
        }
        let root: t.Expression;
        if (astFactory.isIdentifier(declarator.init)) {
          const binding = astBindingAt(
            ctx,
            declarator.init as unknown as BaseNode,
            declarator.init.name,
          );
          root = binding === undefined
            ? astFactory.identifier(declarator.init.name)
            : sourceOrigins.get(binding) ??
              astFactory.identifier(declarator.init.name);
        } else {
          const holder = generatedIdentifier(ctx, 'destructuredSource');
          expanded.push(astFactory.variableDeclarator(holder, declarator.init));
          root = astFactory.identifier(holder.name);
        }
        lowerPattern(declarator.id, root, expanded);
        lowered = true;
      }
      if (lowered) declaration.declarations = expanded;
    },
  });
  refreshAstAnalysis(ctx, programPath.node);
}
