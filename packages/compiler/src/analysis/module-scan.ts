/** Populates module state, helper, and component declarations. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { BaseNode } from '../ast';
import {
  astBindingAt,
  bindingHasVisibleWrite,
  isConstObjectState,
  isStoreObject,
  registerState,
  type ComponentPath,
  type Ctx,
  type HelperPath,
  type ProgramPath,
} from '../context';
import { analyzeComponentProps } from '../components/props';
import { hostJsxEventNames } from '../jsx/events';
import { moduleStateStringCandidates } from './type-candidates';
import {
  discoverTopLevelFunctions,
  findUnlinkedValueImports,
} from './module-discovery';

export function validateLinkedImports(ctx: Ctx, programPath: ProgramPath): void {
  const linked = new Set<string>([
    ...ctx.importedState,
    ...ctx.importedFunctions.keys(),
    ...ctx.importedComponents.keys(),
    ...ctx.importedValues,
  ]);
  for (const imported of findUnlinkedValueImports(
    programPath.node as unknown as BaseNode,
    linked,
  )) {
    throw programPath.buildCodeFrameError(
      `memo-dom: value import '${imported.local}' requires compileModules() so its reactive identity can be linked`,
    );
  }
}
export function scanModuleState(ctx: Ctx, programPath: ProgramPath): void {
  const tagCandidates = moduleStateStringCandidates(programPath.node);
  for (const stmt of programPath.node.body) {
    // M5.5: exported state is still state — unwrap the export wrapper
    const inner = astFactory.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    if (!astFactory.isVariableDeclaration(inner)) continue;
    for (const decl of inner.declarations) {
      if (!astFactory.isIdentifier(decl.id)) continue;
      if (inner.kind === 'let' || inner.kind === 'var') {
        const binding = astBindingAt(
          ctx,
          decl as unknown as BaseNode,
          decl.id.name,
        );
        if (bindingHasVisibleWrite(ctx, binding)) {
          registerState(ctx, decl.id.name, 'let');
        } else if (isStoreObject(decl.init)) {
          registerState(ctx, decl.id.name, 'store');
        } else if (isConstObjectState(decl.init)) {
          registerState(ctx, decl.id.name, 'const');
        }
      } else if (inner.kind === 'const') {
        if (isStoreObject(decl.init)) {
          registerState(ctx, decl.id.name, 'store');
        } else if (isConstObjectState(decl.init)) {
          registerState(ctx, decl.id.name, 'const');
        }
      }
      if (ctx.state.has(decl.id.name)) {
        const candidates = tagCandidates.get(decl.id.name);
        if (candidates !== undefined) {
          ctx.stateTagCandidates.set(decl.id.name, [...candidates]);
        }
      }
    }
  }
}

/**
 * Top-level `function` declarations split by content: with JSX → component
 * (transformed), without → helper (left alone, summarized). Top-level arrow
 * and function-expression variables without JSX are helpers as well. M5.3
 * previously treated every declaration as a component.
 */
export function scanComponents(ctx: Ctx, programPath: ProgramPath): void {
  const unwrapFunctionNode = (
    raw: t.Node | null | undefined,
  ): HelperPath['node'] | null => {
    if (raw === null || raw === undefined) return null;
    let current = raw;
    while (astFactory.isTransparentExpression(current)) {
      current = current.expression;
    }
    if (astFactory.isArrowFunctionExpression(current)) return current;
    return astFactory.isFunctionExpression(current) ? current : null;
  };

  const functionPaths = new Map<t.Node, HelperPath>();
  const asPath = (node: HelperPath['node']): HelperPath => ({
    node,
    buildCodeFrameError(message, at = node) {
      return programPath.buildCodeFrameError(message, at);
    },
  });
  for (const statement of programPath.node.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ||
      astFactory.isExportDefaultDeclaration(statement)
      ? statement.declaration
      : statement;
    if (astFactory.isFunctionDeclaration(declaration)) {
      functionPaths.set(declaration, asPath(declaration));
      continue;
    }
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const declarator of declaration.declarations) {
      const init = unwrapFunctionNode(declarator.init);
      if (init !== null) {
        functionPaths.set(init, asPath(init));
      }
    }
  }

  for (const discovered of discoverTopLevelFunctions(
    programPath.node as unknown as BaseNode,
  )) {
    if (
      ctx.comps.has(discovered.name) ||
      ctx.helpers.has(discovered.name) ||
      ctx.jsxHelpers.has(discovered.name)
    ) {
      continue;
    }
    const path = functionPaths.get(discovered.node as unknown as t.Node);
    if (path === undefined) continue;
    if (discovered.kind === 'helper') {
      ctx.helpers.set(discovered.name, path);
      continue;
    }
    if (discovered.kind === 'jsx-helper') {
      ctx.jsxHelpers.set(discovered.name, path);
      continue;
    }
    if (path.node.type !== 'FunctionDeclaration') continue;
    const componentPath = path as unknown as ComponentPath;
    ctx.comps.set(discovered.name, { parents: new Set(), jsxCount: 0 });
    ctx.compPaths.set(discovered.name, componentPath);
    const hostEvents = hostJsxEventNames(componentPath.node.body);
    ctx.componentHostEvents.set(discovered.name, hostEvents);
    if (hostEvents.length !== 0) {
      ctx.componentsWithHostEvents.add(discovered.name);
    }
    try {
      ctx.componentProps.set(
        discovered.name,
        analyzeComponentProps(componentPath.node.params),
      );
    } catch (error) {
      throw path.buildCodeFrameError(
        `memo-dom: invalid props for component '${discovered.name}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
