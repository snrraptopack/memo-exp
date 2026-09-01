/**
 * analysis.ts — compiler pass 1: module analysis and access-table build.
 *
 * Runs at Program.enter, before any transform:
 *   1. scan module-level reactive state (`let` vars, `const` store objects)
 *   2. scan top-level functions: JSX-bearing ones are COMPONENTS, the rest
 *      are HELPERS (summarized for interprocedural read/write attribution)
 *   3. per component: wire the composition graph (ALL parents), count host
 *      elements, validate every construct L1 does/doesn't support
 *   4. collect reads per component — with list-row attribution and helper
 *      summaries folded in
 *
 * Specialized analysis lives under analysis/: computed state, instance
 * derivations, control-flow replay, component paths, and access-table build.
 *
 * M5.3 fixes living here:
 *   - helpers are no longer mistaken for components (and vice versa)
 *   - multi-parent components route to every instance
 *   - row patterns expand repeated ancestors ('App/Tag[*]/items/Row[*]')
 *   - key={...} outside list rows and state-reading props on static
 *     children are compile errors (were silent miscompiles)
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  isExpression as isAstExpression,
  walkAst,
  type BaseNode,
} from './ast';
import {
  attrExpr,
  astBindingAt,
  collectStateIds,
  isConstObjectState,
  isStoreObject,
  keyPathOf,
  memberKey,
  nodeHasJsx,
  refreshAstAnalysis,
  registerState,
  walkNodes,
  writeTouchesKey,
  type Ctx,
} from './context';
import { analyzeMapSite, containsJsx, matchMapCall } from './lists';
import { transparentListExpression } from './lists/source-shapes';
import { analyzeCondSite } from './conds';
import { summarizeHelper } from './helper-summaries';
import { renderPropReferenceName } from './components/children';
import {
  isRenderCallbackJsxRoot,
  matchRenderCallbackMap,
  scanRenderCallbacks,
} from './components/render-callbacks';
import { analyzeComponentProps } from './components/props';
import { scanEffects } from './effects';
import { scanModuleControlFlow } from './module-control-flow';
import {
  analyzeComputed,
  scanComputeds,
} from './analysis/computed';
import {
  scanInstanceDerivations,
  scanInstanceState,
  excludeRefBindings,
} from './analysis/instance';
import { scanOpaqueVolatility } from './analysis/opaque-volatility';
import {
  finalizeInstancePreludes,
  scanInstanceControlFlow,
} from './analysis/instance-control-flow';
import { pathVariants } from './analysis/component-graph';
import { normalizeComponentJsxValues } from './components/jsx-values';
import { normalizeRenderFunctions } from './components/render-functions';
import { normalizeCalculatedListSources } from './lists/calculated-sources';
import { findTargetedListDependencies } from './lists/targeted-refresh';
import {
  normalizeDynamicTags,
  scanLocalDynamicComponentCandidates,
} from './jsx/dynamic-tags';
import { moduleStateStringCandidates } from './analysis/type-candidates';
import { foldRenderCallbackSubtreeReads } from './analysis/component-reads';
import { scanRefProps } from './components/ref-props';
import { hostJsxEventNames } from './jsx/events';
import { generatedIdentifier } from './identifiers';
import {
  registerTransparentSourceRoots,
  scanTransparentSourceBindings,
} from './data-sources';
import {
  discoverTopLevelFunctions,
  findUnlinkedValueImports,
  subtreeHasJsx,
} from './analysis/module-discovery';

export {
  isLightweightListedComponent,
  isListLightweightCandidate,
  isLightweightRowComponent,
} from './analysis/component-graph';
export { buildAccessTable } from './analysis/access-table';

interface ProgramPath {
  node: t.Program;
  buildCodeFrameError(message: string): Error;
}
type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;
type HelperPath = Ctx['helpers'] extends Map<string, infer TPath>
  ? TPath
  : never;

/** Whether a JSX expression container is a declared component render slot. */
function isRenderAttributeContainer(ctx: Ctx, container: BaseNode): boolean {
  if (container.type !== 'JSXExpressionContainer') return false;
  const attribute = ctx.astAnalysis?.parentByNode.get(container) ?? null;
  if (attribute?.type !== 'JSXAttribute') return false;
  const opening = ctx.astAnalysis?.parentByNode.get(attribute) ?? null;
  if (opening?.type !== 'JSXOpeningElement') return false;
  const openingNode = opening as unknown as t.JSXOpeningElement;
  const tag = openingNode.name;
  if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return false;
  const name = (attribute as unknown as t.JSXAttribute).name;
  const attrName = astFactory.isJSXIdentifier(name) ? name.name : name.name.name;
  return (
    ctx.componentProps.get(tag.name)?.renderProps.includes(attrName) === true
  );
}

// ---------------------------------------------------------------------
// pass 1
// ---------------------------------------------------------------------

function validateLinkedImports(ctx: Ctx, programPath: ProgramPath): void {
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

function scanModuleState(ctx: Ctx, programPath: ProgramPath): void {
  const tagCandidates = moduleStateStringCandidates(programPath.node);
  for (const stmt of programPath.node.body) {
    // M5.5: exported state is still state — unwrap the export wrapper
    const inner = astFactory.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    if (!astFactory.isVariableDeclaration(inner)) continue;
    for (const decl of inner.declarations) {
      if (!astFactory.isIdentifier(decl.id)) continue;
      if (inner.kind === 'let' || inner.kind === 'var') {
        registerState(ctx, decl.id.name, 'let');
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
function scanComponents(ctx: Ctx, programPath: ProgramPath): void {
  const unwrapFunctionNode = (
    raw: t.Node | null | undefined,
  ): HelperPath['node'] | null => {
    if (raw === null || raw === undefined) return null;
    let current = raw;
    while (
      current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSInstantiationExpression'
    ) {
      current = current.expression;
    }
    return current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionExpression'
      ? current
      : null;
  };

  const functionPaths = new Map<t.Node, HelperPath>();
  const asPath = (node: HelperPath['node']): HelperPath => ({
    node,
    buildCodeFrameError(message) {
      return programPath.buildCodeFrameError(message);
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

function scalarTsType(
  type: t.TSType,
  program: t.Program,
  visiting = new Set<string>(),
): boolean {
  if (
    astFactory.isTSStringKeyword(type) ||
    astFactory.isTSNumberKeyword(type) ||
    astFactory.isTSBooleanKeyword(type) ||
    astFactory.isTSBigIntKeyword(type) ||
    astFactory.isTSSymbolKeyword(type) ||
    astFactory.isTSNullKeyword(type) ||
    astFactory.isTSUndefinedKeyword(type) ||
    astFactory.isTSLiteralType(type)
  ) {
    return true;
  }
  if (astFactory.isTSParenthesizedType(type)) {
    return scalarTsType(type.typeAnnotation, program, visiting);
  }
  if (astFactory.isTSUnionType(type)) {
    return type.types.every((member) =>
      scalarTsType(member, program, visiting),
    );
  }
  if (astFactory.isTSTypeReference(type) && astFactory.isIdentifier(type.typeName)) {
    const name = type.typeName.name;
    if (visiting.has(name)) return false;
    const next = new Set(visiting);
    next.add(name);
    for (const statement of program.body) {
      const declaration = astFactory.isExportNamedDeclaration(statement)
        ? statement.declaration
        : statement;
      if (
        astFactory.isTSTypeAliasDeclaration(declaration) &&
        declaration.id.name === name
      ) {
        return scalarTsType(declaration.typeAnnotation, program, next);
      }
    }
  }
  return false;
}

function declaredScalarProp(
  component: t.FunctionDeclaration,
  program: t.Program,
  prop: string,
): boolean {
  const hasNodeType = (node: object, type: string): boolean =>
    (node as unknown as { type?: unknown }).type === type;
  const scalarDefault = (expression: t.Expression): boolean =>
    astFactory.isStringLiteral(expression) ||
    astFactory.isNumericLiteral(expression) ||
    astFactory.isBooleanLiteral(expression) ||
    astFactory.isBigIntLiteral(expression) ||
    (hasNodeType(expression, 'Literal') &&
      (typeof (expression as unknown as { value?: unknown }).value === 'string' ||
        typeof (expression as unknown as { value?: unknown }).value === 'number' ||
        typeof (expression as unknown as { value?: unknown }).value === 'boolean' ||
        typeof (expression as unknown as { value?: unknown }).value === 'bigint')) ||
    (astFactory.isUnaryExpression(expression) &&
      (expression.operator === '+' || expression.operator === '-') &&
      (astFactory.isNumericLiteral(expression.argument) ||
        (hasNodeType(expression.argument, 'Literal') &&
          typeof (expression.argument as unknown as { value?: unknown }).value === 'number')));
  const keyName = (key: t.Expression | t.PrivateName): string | null => {
    if (astFactory.isIdentifier(key)) return key.name;
    if (astFactory.isStringLiteral(key)) return key.value;
    if (hasNodeType(key, 'Literal')) {
      const value = (key as unknown as { value?: unknown }).value;
      return typeof value === 'string' ? value : null;
    }
    return null;
  };
  for (const parameter of component.params) {
    if (astFactory.isTSParameterProperty(parameter)) continue;
    if (
      astFactory.isAssignmentPattern(parameter) &&
      astFactory.isIdentifier(parameter.left, { name: prop }) &&
      scalarDefault(parameter.right)
    ) {
      return true;
    }
    if (
      astFactory.isAssignmentPattern(parameter) &&
      astFactory.isObjectPattern(parameter.left) &&
      astFactory.isObjectExpression(parameter.right)
    ) {
      const defaultProperty = parameter.right.properties.find((property) => {
        if (!astFactory.isObjectProperty(property) || property.computed) return false;
        return keyName(property.key) === prop;
      });
      if (
        astFactory.isObjectProperty(defaultProperty) &&
        astFactory.isExpression(defaultProperty.value) &&
        scalarDefault(defaultProperty.value)
      ) {
        return true;
      }
    }
    const parameterTarget = astFactory.isAssignmentPattern(parameter)
      ? parameter.left
      : parameter;
    if (!astFactory.isObjectPattern(parameterTarget)) continue;
    for (const property of parameterTarget.properties) {
      if (!astFactory.isObjectProperty(property) || property.computed) continue;
      if (
        keyName(property.key) === prop &&
        astFactory.isAssignmentPattern(property.value) &&
        scalarDefault(property.value.right)
      ) {
        return true;
      }
    }
  }

  const first = component.params[0];
  if (first == null || astFactory.isTSParameterProperty(first)) return false;
  const target = astFactory.isAssignmentPattern(first) ? first.left : first;
  if (
    !astFactory.isIdentifier(target) &&
    !astFactory.isObjectPattern(target) &&
    !astFactory.isArrayPattern(target)
  ) {
    return false;
  }
  const annotation = target.typeAnnotation;
  if (!astFactory.isTSTypeAnnotation(annotation)) return false;

  let shape = annotation.typeAnnotation;
  if (astFactory.isTSTypeReference(shape) && astFactory.isIdentifier(shape.typeName)) {
    const referenceName = shape.typeName.name;
    const declaration = program.body
      .map((statement) =>
        astFactory.isExportNamedDeclaration(statement)
          ? statement.declaration
          : statement,
      )
      .find(
        (candidate) =>
          (astFactory.isTSInterfaceDeclaration(candidate) ||
            astFactory.isTSTypeAliasDeclaration(candidate)) &&
          candidate.id.name === referenceName,
      );
    if (astFactory.isTSInterfaceDeclaration(declaration)) {
      shape = astFactory.tsTypeLiteral(declaration.body.body);
    } else if (astFactory.isTSTypeAliasDeclaration(declaration)) {
      shape = declaration.typeAnnotation;
    }
  }
  if (!astFactory.isTSTypeLiteral(shape)) return false;
  for (const member of shape.members) {
    if (!astFactory.isTSPropertySignature(member) || member.computed) continue;
    if (
      keyName(member.key) === prop &&
      astFactory.isTSTypeAnnotation(member.typeAnnotation)
    ) {
      return scalarTsType(
        member.typeAnnotation.typeAnnotation,
        program,
      );
    }
  }
  return false;
}

function expressionCarriesJsx(
  ctx: Ctx,
  expression: BaseNode,
  visiting = new Set<BaseNode>(),
): boolean {
  if (subtreeHasJsx(expression)) return true;
  if (visiting.has(expression)) return false;
  visiting.add(expression);
  if (expression.type === 'Identifier') {
    const name = (expression as unknown as { name: string }).name;
    const binding = ctx.astAnalysis?.nodeToScope.get(expression)?.getBinding(name);
    let declaration: BaseNode | null = binding?.identifier ?? null;
    while (
      declaration !== null &&
      declaration !== binding?.declarationNode &&
      declaration.type !== 'VariableDeclarator'
    ) {
      declaration = ctx.astAnalysis?.parentByNode.get(declaration) ?? null;
    }
    if (declaration?.type === 'VariableDeclarator') {
      const init = (declaration as unknown as { init?: unknown }).init;
      return isAstExpression(init)
        ? expressionCarriesJsx(ctx, init, visiting)
        : false;
    }
  }
  if (expression.type === 'MemberExpression') {
    const object = (expression as unknown as { object?: unknown }).object;
    return isAstExpression(object)
      ? expressionCarriesJsx(ctx, object, visiting)
      : false;
  }
  return false;
}

/**
 * Discover props that are consumed as mount slots. Direct JSX-child use is
 * the defining contract; forwarding through another declared render prop is
 * propagated to a fixed point for wrapper components.
 */
function scanRenderProps(ctx: Ctx): void {
  const program = ctx.astAnalysis?.rootScope.block;
  if (program?.type !== 'Program') return;
  const potential = new Map<string, Set<string>>();
  for (const [name, componentPath] of ctx.compPaths) {
    const candidates = new Set<string>();
    potential.set(name, candidates);
    walkAst<BaseNode>(componentPath.node as unknown as BaseNode, {
      enter(node, parent) {
        if (node.type !== 'JSXExpressionContainer') return;
        if (
          parent?.type !== 'JSXElement' &&
          parent?.type !== 'JSXFragment'
        ) {
          return;
        }
        const expression = (node as unknown as { expression?: unknown }).expression;
        if (!isAstExpression(expression)) return;
        const prop = renderPropReferenceName(ctx, name, expression);
        if (prop === null) return;
        if (
          !declaredScalarProp(
            componentPath.node,
            program as unknown as t.Program,
            prop,
          )
        ) {
          candidates.add(prop);
        }
      },
    });
    const componentParent = ctx.astAnalysis?.parentByNode.get(
      componentPath.node as unknown as BaseNode,
    ) ?? null;
    if (
      (componentParent?.type === 'ExportNamedDeclaration' ||
        componentParent?.type === 'ExportDefaultDeclaration') &&
      !ctx.linkedComponentRenderProps.has(name)
    ) {
      const plan = ctx.componentProps.get(name)!;
      for (const candidate of candidates) {
        if (!plan.renderProps.includes(candidate)) {
          plan.renderProps.push(candidate);
        }
      }
    }
  }

  // Untyped interpolation is scalar by default. Positive caller JSX evidence
  // declares a mount slot; linked callers provide the same evidence through
  // linkedComponentRenderProps below. This avoids guessing from host layout.
  const localUsage = new Map<
    string,
    Map<string, { scalar: boolean; jsx: boolean; at: Ctx['compPaths'] extends Map<string, infer TPath> ? TPath : never }>
  >();
  for (const [owner, ownerPath] of ctx.compPaths) {
    walkAst<BaseNode>(ownerPath.node as unknown as BaseNode, {
      enter(node) {
        if (node.type !== 'JSXElement') return;
        const element = node as unknown as t.JSXElement;
        const tag = element.openingElement.name;
        if (!astFactory.isJSXIdentifier(tag) || !ctx.comps.has(tag.name)) return;
        const target = ctx.componentProps.get(tag.name)!;
        const candidates = potential.get(tag.name);
        if (candidates === undefined) return;
        let byProp = localUsage.get(tag.name);
        if (byProp === undefined) {
          byProp = new Map();
          localUsage.set(tag.name, byProp);
        }
        if (
          candidates.has('children') &&
          element.children.some(
            (child) =>
              !astFactory.isJSXText(child) || child.value.trim() !== '',
          ) &&
          !target.renderProps.includes('children')
        ) {
          target.renderProps.push('children');
          byProp.set('children', {
            scalar: false,
            jsx: true,
            at: ownerPath,
          });
        }
        for (const attribute of element.openingElement.attributes) {
          if (!astFactory.isJSXAttribute(attribute)) continue;
          const name = attribute.name;
          const prop = astFactory.isJSXIdentifier(name) ? name.name : name.name.name;
          if (
            !candidates.has(prop)
          ) {
            continue;
          }
          const usage = byProp.get(prop) ?? {
            scalar: false,
            jsx: false,
            at: ownerPath,
          };
          const value = attribute.value;
          let carriesJsx = false;
          if (
            astFactory.isJSXExpressionContainer(value) &&
            isAstExpression(value.expression)
          ) {
            if (
              expressionCarriesJsx(ctx, value.expression) ||
              renderPropReferenceName(ctx, owner, value.expression) !== null
            ) {
              carriesJsx = true;
            }
          }
          if (carriesJsx) usage.jsx = true;
          else usage.scalar = true;
          byProp.set(prop, usage);
        }
      },
    });
  }
  for (const [component, byProp] of localUsage) {
    const plan = ctx.componentProps.get(component)!;
    for (const [prop, usage] of byProp) {
      if (usage.scalar && usage.jsx) {
        if (prop === 'children') {
          if (!plan.renderProps.includes(prop)) plan.renderProps.push(prop);
          continue;
        }
        throw usage.at.buildCodeFrameError(
          `memo-dom: prop '${prop}' on <${component}> is used as both scalar data and JSX content`,
        );
      }
      if (usage.jsx) {
        if (!plan.renderProps.includes(prop)) plan.renderProps.push(prop);
      } else if (usage.scalar) {
        plan.renderProps = plan.renderProps.filter(
          (candidate) => candidate !== prop,
        );
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, componentPath] of ctx.compPaths) {
      const plan = ctx.componentProps.get(name)!;
      walkAst<BaseNode>(componentPath.node as unknown as BaseNode, {
        enter(node, parent) {
          if (node.type !== 'JSXAttribute') return;
          const attribute = node as unknown as t.JSXAttribute;
          const container = attribute.value;
          if (
            !astFactory.isJSXExpressionContainer(container) ||
            !isAstExpression(container.expression)
          ) {
            return;
          }
          const sourceProp = renderPropReferenceName(
            ctx,
            name,
            container.expression,
          );
          if (sourceProp === null || plan.renderProps.includes(sourceProp)) {
            return;
          }
          if (parent?.type !== 'JSXOpeningElement') return;
          const tag = (parent as unknown as t.JSXOpeningElement).name;
          if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
          const target = ctx.componentProps.get(tag.name);
          const attr = attribute.name;
          const attrName = astFactory.isJSXIdentifier(attr) ? attr.name : attr.name.name;
          if (target?.renderProps.includes(attrName) === true) {
            plan.renderProps.push(sourceProp);
            changed = true;
          }
        },
      });
    }
  }

  for (const [component, renderProps] of ctx.linkedComponentRenderProps) {
    const plan = ctx.componentProps.get(component);
    if (plan !== undefined) plan.renderProps = [...renderProps];
  }
}

/**
 * Every static path variant at which instances of `name` can live: walks ALL
 * parents (multi-parent components) and expands repeated edges into '[*]'
 * variants. Cycle-safe: recursive components throw.
 */
/**
 * Per component: wire the composition graph, count host elements, and
 * reject (or, for R7, validate) every construct with actionable errors.
 */
function analyzeComponent(ctx: Ctx, name: string): void {
  const p = ctx.compPaths.get(name)!;
  const info = ctx.comps.get(name)!;
  const fail = (message: string): never => {
    throw p.buildCodeFrameError(message);
  };
  const checkMapCall = (call: BaseNode): boolean => {
    const mapCall = matchMapCall(
      call as unknown as t.CallExpression | t.OptionalCallExpression,
    );
    if (
      mapCall &&
      (containsJsx(call) ||
        matchRenderCallbackMap(ctx, name, mapCall) !== null)
    ) {
      // allowed ONLY as a direct JSX child: <ul>{items.map(...)}</ul>
      const parent = ctx.astAnalysis?.parentByNode.get(call) ?? null;
      const grand = parent === null
        ? null
        : ctx.astAnalysis?.parentByNode.get(parent) ?? null;
      if (
        parent?.type !== 'JSXExpressionContainer' ||
        (grand?.type !== 'JSXElement' &&
          grand?.type !== 'JSXFragment' &&
          !isRenderAttributeContainer(ctx, parent))
      ) {
        fail(
          'memo-dom: list rendering must be a direct JSX child: <ul>{items.map(item => <Row />)}</ul>',
        );
      }
      // full form validation happens in collectReads (needs composition)
      return false;
    }
    return true;
  };
  walkAst<BaseNode>(p.node as unknown as BaseNode, {
    enter(node) {
      if (node.type === 'JSXElement') {
      const element = node as unknown as t.JSXElement;
      const open = element.openingElement;
      const openName = open.name;
      if (!astFactory.isJSXIdentifier(openName)) {
        return fail(
          'memo-dom: namespaced or member-expression JSX tags are not supported (L1)',
        );
      }
      // key is region metadata — meaningless (and misleading) elsewhere
      for (const attr of open.attributes) {
        if (
          !astFactory.isJSXSpreadAttribute(attr) &&
          astFactory.isJSXIdentifier(attr.name, { name: 'key' })
        ) {
          if (isRenderCallbackJsxRoot(ctx, node)) continue;
          fail(
            'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
          );
        }
      }
      const tag = openName.name;
      if (/^[A-Z]/.test(tag)) {
        const localComponent = ctx.comps.has(tag);
        if (!localComponent && !ctx.importedComponents.has(tag)) {
          fail(
            `memo-dom: <${tag} /> is not a linked component factory`,
          );
        }
        // R10: state-reading props are allowed — prop reads are collected
        // by collectReads' generic Identifier/MemberExpression visitors (no
        // component skip there), so the parent updates exactly when a pushed
        // value can change. (Was the mount-time ban, now lifted.)
        if (localComponent) ctx.comps.get(tag)!.parents.add(name);
        let counts = ctx.childRefCounts.get(name);
        if (!counts) ctx.childRefCounts.set(name, (counts = new Map()));
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        if (
          element.children.some(
            (child) =>
              !astFactory.isJSXText(child) || child.value.trim() !== '',
          ) ||
          open.attributes.some((attribute) => {
            if (
              astFactory.isJSXSpreadAttribute(attribute) ||
              ctx.componentProps
                .get(tag)
                ?.renderProps.includes(
                  astFactory.isJSXIdentifier(attribute.name)
                    ? attribute.name.name
                    : attribute.name.name.name,
                ) !== true
            ) {
              return false;
            }
            const value = attrExpr(attribute.value);
            return value !== null && nodeHasJsx(value);
          })
        ) {
          ctx.renderSlotOwners.add(name);
        }
        // Nested syntax is a lexical content slot owned by this component.
        // Continue into it to discover and validate the authored subtree.
        return;
      }
      info.jsxCount++;
      return;
      }
      if (node.type === 'ConditionalExpression' && containsJsx(node)) {
        const parent = ctx.astAnalysis?.parentByNode.get(node) ?? null;
        const grand = parent === null
          ? null
          : ctx.astAnalysis?.parentByNode.get(parent) ?? null;
        if (
          parent?.type !== 'JSXExpressionContainer' ||
          (grand?.type !== 'JSXElement' &&
            grand?.type !== 'JSXFragment' &&
            !isRenderAttributeContainer(ctx, parent))
        ) {
          fail(
            'memo-dom: conditional rendering must be a direct JSX child: <div>{cond ? <A/> : <B/>}</div>',
          );
        }
        return false;
      }
      if (node.type === 'LogicalExpression' && containsJsx(node)) {
        const logical = node as unknown as t.LogicalExpression;
        if (logical.operator !== '&&' && logical.operator !== '||') {
          fail(
            'memo-dom: only && / || conditionals are supported (R8 L1), not ??',
          );
        }
        const parent = ctx.astAnalysis?.parentByNode.get(node) ?? null;
        const grand = parent === null
          ? null
          : ctx.astAnalysis?.parentByNode.get(parent) ?? null;
        if (
          parent?.type !== 'JSXExpressionContainer' ||
          (grand?.type !== 'JSXElement' &&
            grand?.type !== 'JSXFragment' &&
            !isRenderAttributeContainer(ctx, parent))
        ) {
          fail(
            'memo-dom: conditional rendering must be a direct JSX child: <div>{cond ? <A/> : <B/>}</div>',
          );
        }
        return false;
      }
      if (
        node.type === 'CallExpression' ||
        node.type === 'OptionalCallExpression'
      ) {
        return checkMapCall(node);
      }
      return;
    },
  });
}

// ---------------------------------------------------------------------
// shared read/write classifiers
// ---------------------------------------------------------------------

/** Is this complete member expression being invoked (`store.items.method()`)? */
function isMemberCallCallee(ctx: Ctx, member: BaseNode): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(member) ?? null;
  return (
    parent?.type === 'CallExpression' &&
    (parent as unknown as t.CallExpression).callee === member
  );
}

/**
 * The dotted read key of a store member expression ('store.items.length'),
 * or null when it is not a read (write target, method callee, non-store).
 */
function storeReadKey(ctx: Ctx, member: BaseNode): string | null {
  const expression = member as unknown as t.MemberExpression;
  const key = memberKey(expression);
  if (!key || !key.includes('.')) return null;
  const rootName = key.split('.')[0]!;
  if (ctx.state.get(rootName) !== 'store') return null;
  if (astBindingAt(ctx, member, rootName)?.scope.isProgramScope !== true) {
    return null;
  }
  const parent = ctx.astAnalysis?.parentByNode.get(member) ?? null;
  if (
    parent?.type === 'AssignmentExpression' &&
    (parent as unknown as t.AssignmentExpression).operator === '=' &&
    (parent as unknown as t.AssignmentExpression).left === expression
  ) {
    return null; // write target, not a read
  }
  if (isMemberCallCallee(ctx, member)) return null;
  return key;
}

// ---------------------------------------------------------------------
// reads per component (with list + helper attribution)
// ---------------------------------------------------------------------

function addInstanceReasons(
  ctx: Ctx,
  component: string,
  additions: Iterable<string>,
): void {
  const sources = new Set([
    ...(ctx.instanceReasonIds.get(component)?.keys() ?? []),
    ...additions,
  ]);
  ctx.instanceReasonIds.set(
    component,
    new Map(
      [...sources]
        .sort()
        .map((source, index) => [source, index]),
    ),
  );
}

function directItemWrittenPath(
  member: t.MemberExpression,
  source: string,
): string[] | null {
  const chain: t.MemberExpression[] = [];
  let current: t.Expression = member;
  for (;;) {
    current = transparentListExpression(current);
    if (!astFactory.isMemberExpression(current)) break;
    chain.unshift(current);
    if (astFactory.isSuper(current.object)) return null;
    current = current.object;
  }
  if (!astFactory.isIdentifier(current, { name: source })) return null;
  const itemAccess = chain[0];
  if (
    itemAccess === undefined ||
    !itemAccess.computed ||
    !astFactory.isExpression(itemAccess.property) ||
    !(
      astFactory.isIdentifier(itemAccess.property) ||
      astFactory.isNumericLiteral(itemAccess.property) ||
      astFactory.isStringLiteral(itemAccess.property)
    ) ||
    chain.length < 2
  ) {
    return null;
  }
  const path: string[] = [];
  for (const segment of chain.slice(1)) {
    if (!segment.computed && astFactory.isIdentifier(segment.property)) {
      path.push(segment.property.name);
    } else if (segment.computed && astFactory.isStringLiteral(segment.property)) {
      path.push(segment.property.value);
    } else {
      return null;
    }
  }
  return path;
}

function componentHasDirectItemMutation(
  component: t.FunctionDeclaration,
  source: string,
  keyPath: string[],
): boolean {
  let found = false;
  walkNodes(component.body, (node) => {
    if (found) return;
    const target =
      astFactory.isAssignmentExpression(node) && astFactory.isMemberExpression(node.left)
        ? node.left
        : astFactory.isUpdateExpression(node) && astFactory.isMemberExpression(node.argument)
          ? node.argument
          : astFactory.isUnaryExpression(node, { operator: 'delete' }) &&
              astFactory.isMemberExpression(node.argument)
            ? node.argument
            : null;
    if (target === null) return;
    const writtenPath = directItemWrittenPath(target, source);
    if (writtenPath !== null && !writeTouchesKey(writtenPath, keyPath)) {
      found = true;
    }
  });
  return found;
}

function registerKeyedListMutationPlan(
  ctx: Ctx,
  component: string,
  call: t.CallExpression | t.OptionalCallExpression,
  site: ReturnType<typeof analyzeMapSite>,
): void {
  if (!site.sourceLocal || !astFactory.isIdentifier(site.sourceExpr)) return;
  const source = site.sourceExpr.name;
  if (ctx.instanceState.get(component)?.has(source) !== true) return;
  const keyPath = keyPathOf(site.keyExpr, site.itemParam);
  if (keyPath === null || keyPath.length === 0) return;
  const componentPath = ctx.compPaths.get(component);
  if (
    componentPath === undefined ||
    !componentHasDirectItemMutation(componentPath.node, source, keyPath)
  ) {
    return;
  }

  const address = `${component}\0${source}`;
  if (ctx.disabledKeyedListMutationSources.has(address)) return;
  let sources = ctx.keyedListMutationSources.get(component);
  if (sources === undefined) {
    sources = new Map();
    ctx.keyedListMutationSources.set(component, sources);
  }
  const existing = sources.get(source);
  if (existing !== undefined) {
    // One journal cannot be consumed independently by two list regions.
    ctx.keyedListMutations.delete(existing.call);
    sources.delete(source);
    ctx.disabledKeyedListMutationSources.add(address);
    return;
  }

  const plan = {
    source,
    keyPath,
    keysVariable: generatedIdentifier(ctx, `${source}ChangedKeys`).name,
    targetedReason: `${address}\0content`,
    structuralReason: `${address}\0structure`,
    call,
  };
  sources.set(source, plan);
  ctx.keyedListMutations.set(call, plan);
  ctx.targetedListComponents.add(component);
  addInstanceReasons(ctx, component, [
    source,
    plan.targetedReason,
    plan.structuralReason,
  ]);
}

/**
 * Reads per component, with list attribution:
 *  - `items.map(...)` records `items` as an owner read; the callback is
 *    validated and skipped for owner reads.
 *  - component rows: the row comp is marked listed at this site.
 *  - inline rows: state reads inside the row JSX belong to the row pattern.
 * Helper calls fold their summarized reads into the calling context.
 */
function collectReads(ctx: Ctx): void {
  for (const [name] of ctx.comps) {
    const p = ctx.compPaths.get(name)!;
    const reads = new Set<string>();
    const usedPrefixes = new Map<string, number>();
    const usedConds = { count: 0 };

    /**
     * A list nested in a conditional branch is emitted below the conditional
     * entity (`<owner>/whenN/<list>`). The condition owns source/prop replay;
     * this pass still records component-row placement and inline-row reads so
     * routing matches the nested runtime ids.
     */
    function collectConditionalMap(
      call: t.CallExpression | t.OptionalCallExpression,
      condSuffix: string,
      branchPrefixes: Map<string, number>,
    ): boolean {
      const mapCall = matchMapCall(call);
      if (mapCall === null || !containsJsx(call as unknown as BaseNode)) {
        return true;
      }
      const site = analyzeMapSite(
        ctx,
        mapCall,
        p,
        name,
        branchPrefixes,
      );
      const nestedSuffix = `${condSuffix}/${site.suffix}`;

      if (site.form === 'component') {
        const sites = ctx.listedSites.get(site.rowComp!) ?? [];
        if (
          !sites.some(
            (existing) =>
              existing.owner === name &&
              existing.suffix === nestedSuffix,
          )
        ) {
          sites.push({
            owner: name,
            suffix: nestedSuffix,
            itemParam: site.itemParam,
            keyExpr: site.keyExpr,
            sourceKey: site.sourceKey,
            sourceLocal: site.sourceLocal,
          });
        }
        ctx.listedSites.set(site.rowComp!, sites);
      } else {
        collectInlineRowSite(call, site, nestedSuffix);
      }
      return false;
    }

    function recordConditionalComponent(
      element: t.JSXElement,
      condSuffix: string,
      childCounts: Map<string, number>,
    ): void {
      const tag = element.openingElement.name;
      if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
      if (!ctx.comps.has(tag.name) && !ctx.importedComponents.has(tag.name)) {
        throw p.buildCodeFrameError(
          `memo-dom: <${tag.name} /> is not a linked component factory`,
        );
      }

      const seen = childCounts.get(tag.name) ?? 0;
      childCounts.set(tag.name, seen + 1);
      const componentSuffix =
        seen === 0 ? tag.name : `${tag.name}[${seen}]`;
      const suffix = `${condSuffix}/${componentSuffix}`;
      const sites = ctx.conditionalComponentSites.get(tag.name) ?? [];
      if (
        !sites.some(
          (site) => site.owner === name && site.suffix === suffix,
        )
      ) {
        sites.push({ owner: name, suffix });
      }
      ctx.conditionalComponentSites.set(tag.name, sites);
    }

    function recordRowComponent(
      element: t.JSXElement,
      containerSuffix: string,
      childCounts: Map<string, number>,
    ): void {
      const tag = element.openingElement.name;
      if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
      if (!ctx.comps.has(tag.name) && !ctx.importedComponents.has(tag.name)) {
        throw p.buildCodeFrameError(
          `memo-dom: <${tag.name} /> is not a linked component factory`,
        );
      }
      const seen = childCounts.get(tag.name) ?? 0;
      childCounts.set(tag.name, seen + 1);
      const componentSuffix =
        seen === 0 ? tag.name : `${tag.name}[${seen}]`;
      const suffix =
        `${containerSuffix}/Row[*]/${componentSuffix}`;
      const sites = ctx.rowComponentSites.get(tag.name) ?? [];
      if (
        !sites.some(
          (site) => site.owner === name && site.suffix === suffix,
        )
      ) {
        sites.push({ owner: name, suffix });
      }
      ctx.rowComponentSites.set(tag.name, sites);
    }

    function recordListedSite(site: ReturnType<typeof analyzeMapSite>, suffix: string): void {
      const sites = ctx.listedSites.get(site.rowComp!) ?? [];
      if (
        !sites.some(
          (existing) =>
            existing.owner === name && existing.suffix === suffix,
        )
      ) {
        sites.push({
          owner: name,
          suffix,
          itemParam: site.itemParam,
          keyExpr: site.keyExpr,
          sourceKey: site.sourceKey,
          sourceLocal: site.sourceLocal,
        });
      }
      ctx.listedSites.set(site.rowComp!, sites);
    }

    function collectInlineRowSite(
      call: t.CallExpression | t.OptionalCallExpression,
      site: ReturnType<typeof analyzeMapSite>,
      containerSuffix: string,
    ): void {
      const callback = call.arguments[0] as unknown as BaseNode | undefined;
      if (callback === undefined) return;
      const rowVars = new Set<string>();
      const childCounts = new Map<string, number>();
      const nestedPrefixes = new Map<string, number>();

      const checkNestedCall = (innerNode: BaseNode): boolean => {
        const inner = innerNode as unknown as
          | t.CallExpression
          | t.OptionalCallExpression;
        const nestedMap = matchMapCall(inner);
        if (nestedMap !== null && containsJsx(inner)) {
          const nestedSite = analyzeMapSite(
            ctx,
            nestedMap,
            p,
            name,
            nestedPrefixes,
            site,
          );
          const nestedSuffix =
            `${containerSuffix}/Row[*]/${nestedSite.suffix}`;
          if (nestedSite.form === 'component') {
            recordListedSite(nestedSite, nestedSuffix);
          } else {
            collectInlineRowSite(inner, nestedSite, nestedSuffix);
          }
          return false;
        }
        const callee = inner.callee;
        if (
          astFactory.isIdentifier(callee) &&
          (ctx.helpers.has(callee.name) ||
            ctx.importedFunctions.has(callee.name)) &&
          astBindingAt(ctx, innerNode, callee.name)?.scope.isProgramScope === true
        ) {
          const summary =
            ctx.importedFunctions.get(callee.name) ??
            summarizeHelper(ctx, callee.name);
          for (const read of summary.reads) rowVars.add(read);
        }
        return true;
      };

      walkAst<BaseNode>(callback, {
        enter(node) {
          if (node.type === 'Identifier') {
            const id = node as unknown as t.Identifier;
          if (
              id.name !== site.itemParam &&
              ctx.state.has(id.name) &&
              astBindingAt(ctx, node, id.name)?.scope.isProgramScope === true
          ) {
              rowVars.add(id.name);
          }
          }
          if (node.type === 'JSXElement') {
            recordRowComponent(
              node as unknown as t.JSXElement,
              containerSuffix,
              childCounts,
            );
          }
          if (
            node.type === 'CallExpression' ||
            node.type === 'OptionalCallExpression'
          ) {
            return checkNestedCall(node);
          }
          return;
        },
      });

      if (rowVars.size > 0) {
        ctx.rowReads.set(`${name}/${containerSuffix}`, {
          owner: name,
          suffix: containerSuffix,
          vars: rowVars,
        });
      }
    }

    /**
     * R8: a JSX-bearing conditional is a REGION — every state var read in
     * the condition OR either branch is attributed to the region's patterns
     * ('<owner>/when<n>'), so writes dirty the region, not the owner.
     */
    function handleCond(
      node: t.ConditionalExpression | t.LogicalExpression,
      parentSuffix: string | null = null,
    ): boolean {
      const rawNode = node as unknown as BaseNode;
      if (!containsJsx(rawNode)) return true;
      const site = analyzeCondSite(node, p, usedConds);
      const fullSuffix =
        parentSuffix === null
          ? site.suffix
          : `${parentSuffix}/${site.suffix}`;
      const branches: t.Expression[] = [];
      if (astFactory.isConditionalExpression(node)) {
        let current: t.Expression = node;
        while (astFactory.isConditionalExpression(current)) {
          branches.push(current.consequent);
          current = current.alternate;
        }
        branches.push(current);
      } else {
        branches.push(node.right);
      }
      for (const branch of branches) {
        const branchPrefixes = new Map<string, number>();
        const branchChildren = new Map<string, number>();
        if (
          (astFactory.isConditionalExpression(branch) || astFactory.isLogicalExpression(branch)) &&
          containsJsx(branch as unknown as BaseNode)
        ) {
          handleCond(branch, fullSuffix);
          continue;
        }
        if (astFactory.isJSXElement(branch)) {
          recordConditionalComponent(
            branch,
            fullSuffix,
            branchChildren,
          );
        }
        const branchRoot = branch as unknown as BaseNode;
        walkAst<BaseNode>(branchRoot, {
          enter(current) {
            if (current === branchRoot) return;
            if (
              (current.type === 'ConditionalExpression' ||
                current.type === 'LogicalExpression') &&
              containsJsx(current)
            ) {
              return handleCond(
                current as unknown as
                  | t.ConditionalExpression
                  | t.LogicalExpression,
                fullSuffix,
              );
            }
            if (current.type === 'JSXElement') {
              recordConditionalComponent(
                current as unknown as t.JSXElement,
                fullSuffix,
                branchChildren,
              );
            }
            if (
              current.type === 'CallExpression' ||
              current.type === 'OptionalCallExpression'
            ) {
              return collectConditionalMap(
                current as unknown as
                  | t.CallExpression
                  | t.OptionalCallExpression,
                fullSuffix,
                branchPrefixes,
              );
            }
            return;
          },
        });
      }
      const vars = collectStateIds(ctx, node);
      // Nested regions replay through their enclosing branch updater. Keep
      // module routing at the outermost region so one write cannot schedule
      // both ancestor and descendant regions for the same calculation.
      if (vars.size > 0 && parentSuffix === null) {
        ctx.condReads.set(`${name}/${fullSuffix}`, {
          owner: name,
          suffix: fullSuffix,
          vars,
        });
      }
      return false;
    }

    function checkCallExpression(callNode: BaseNode): boolean {
      const call = callNode as unknown as
        | t.CallExpression
        | t.OptionalCallExpression;
      if (
        astFactory.isIdentifier(call.callee, { name: 'effect' }) &&
        astBindingAt(ctx, callNode, 'effect') === undefined
      ) {
        return false;
      }
      const mapCall = matchMapCall(call);
      if (
        mapCall &&
        (containsJsx(callNode) ||
          matchRenderCallbackMap(ctx, name, mapCall) !== null)
      ) {
        const site = analyzeMapSite(ctx, mapCall, p, name, usedPrefixes);
        registerKeyedListMutationPlan(ctx, name, mapCall, site);
        const targeted = findTargetedListDependencies(
          site,
          ctx.instanceState.get(name) ?? new Set(),
        );
        if (targeted.length > 0 && astFactory.isIdentifier(site.sourceExpr)) {
          const source = site.sourceExpr.name;
          ctx.targetedListDependencies.set(
            mapCall,
            targeted.map((value) => ({
              source,
              value,
            })),
          );
          ctx.targetedListComponents.add(name);
          addInstanceReasons(ctx, name, [source, ...targeted]);
        }
        if (!site.sourceLocal) reads.add(site.sourceKey);
        if (site.form === 'component') {
          // R10: row-prop reads are OWNER reads — the owner re-pushes row
          // props via updateProps during reconcile
          for (const attr of site.jsx!.openingElement.attributes) {
            if (astFactory.isJSXSpreadAttribute(attr)) continue;
            const a = attr as t.JSXAttribute;
            const propName = astFactory.isJSXIdentifier(a.name)
              ? a.name.name
              : `${a.name.namespace.name}:${a.name.name.name}`;
            if (
              propName === 'key' ||
              propName === 'ref' ||
              ctx.componentProps
                .get(site.rowComp!)
                ?.refProps.includes(propName) === true
            ) {
              continue;
            }
            const v = attrExpr(a.value);
            if (!v) continue;
            walkNodes(v, (n) => {
              if (
                astFactory.isIdentifier(n) &&
                ctx.state.has(n.name) &&
                astBindingAt(
                  ctx,
                  n as unknown as BaseNode,
                  n.name,
                )?.scope.isProgramScope === true
              ) {
                reads.add(n.name);
              }
              if (astFactory.isMemberExpression(n)) {
                const key = memberKey(n);
                if (key !== null && key.includes('.')) {
                  const rootName = key.split('.')[0]!;
                  if (
                    ctx.state.get(rootName) === 'store' &&
                    astBindingAt(
                      ctx,
                      n as unknown as BaseNode,
                      rootName,
                    )?.scope.isProgramScope === true
                  ) {
                    reads.add(key);
                  }
                }
              }
            });
          }
          const sites = ctx.listedSites.get(site.rowComp!) ?? [];
          if (!sites.some((s) => s.owner === name && s.suffix === site.suffix)) {
            sites.push({
              owner: name,
              suffix: site.suffix,
              itemParam: site.itemParam,
              keyExpr: site.keyExpr,
              sourceKey: site.sourceKey,
              sourceLocal: site.sourceLocal,
            });
          }
          ctx.listedSites.set(site.rowComp!, sites);
        } else {
          collectInlineRowSite(call, site, site.suffix);
        }
        return false;
      }
      // helper calls: the callee's summarized reads belong to this component
      const callee = call.callee;
      if (
        astFactory.isIdentifier(callee) &&
        (ctx.helpers.has(callee.name) || ctx.importedFunctions.has(callee.name)) &&
        astBindingAt(ctx, callNode, callee.name)?.scope.isProgramScope === true
      ) {
        const summary =
          ctx.importedFunctions.get(callee.name) ?? summarizeHelper(ctx, callee.name);
        for (const r of summary.reads) reads.add(r);
      }
      return true;
    }

    walkAst<BaseNode>(p.node as unknown as BaseNode, {
      enter(node) {
        if (node.type === 'JSXAttribute') {
          const attribute = node as unknown as t.JSXAttribute;
          const attributeName = attribute.name;
        if (
            astFactory.isJSXIdentifier(attributeName, { name: 'ref' }) ||
            (astFactory.isJSXNamespacedName(attributeName) &&
              attributeName.namespace.name === 'ref')
        ) {
            return false;
        }
          return;
        }
        if (
          node.type === 'ConditionalExpression' ||
          node.type === 'LogicalExpression'
        ) {
          return handleCond(
            node as unknown as
              | t.ConditionalExpression
              | t.LogicalExpression,
          );
        }
        if (
          node.type === 'CallExpression' ||
          node.type === 'OptionalCallExpression'
        ) {
          return checkCallExpression(node);
        }
        if (node.type === 'Identifier') {
          const id = node as unknown as t.Identifier;
          if (!ctx.state.has(id.name)) return;
        // Static-table keys identify module bindings, not same-spelled props,
        // instance state, or local derivations.
          if (astBindingAt(ctx, node, id.name)?.scope.isProgramScope !== true) {
            return;
          }
          const parent = ctx.astAnalysis?.parentByNode.get(node) ?? null;
        if (
            parent?.type === 'AssignmentExpression' &&
            (parent as unknown as t.AssignmentExpression).operator === '=' &&
            (parent as unknown as t.AssignmentExpression).left === id
        ) {
          return; // write target, not a read
        }
          reads.add(id.name);
          return;
        }
        if (node.type === 'MemberExpression') {
          const key = storeReadKey(ctx, node);
          if (key !== null) reads.add(key);
        }
        return;
      },
    });

    ctx.compReads.set(name, reads);
  }
}

/**
 * R13: analyze a candidate computed initializer — collect the state keys it
 * reads and decide whether it is a legal derivation.
 *
 * Detection is BY REFERENCE (R13.1, replacing the PURE_METHODS whitelist):
 * any expression that mentions an already-declared state variable is a
 * derivation — arbitrary method calls, unknown/imported/global functions,
 * `new`, tagged templates, and local-mutating callbacks are all fine. A
 * derivation recomputes on every write to its sources and computedChanged
 * gates what propagates downstream; keeping it a pure function of state is
 * the author's responsibility (same contract as Vue computed / Svelte $:).
 *
 * Rejected syntax covers only what would corrupt the state model itself:
 *   - assignments / updates to non-locals (writes belong in handlers)
 *   - calls to module helpers KNOWN to write state (reuses the same write
 *     analysis handlers rely on — a precise negative, not a whitelist)
 *   - await / yield (derivations must be synchronous)
 * Locals (nested function params, declarators) are collected conservatively
 * (name-wide), so `reduce((acc, t) => { acc.push(t); return acc; }, [])`
 * and `(s, t) => (s += t.n, s)` are fine. The walk never early-exits on
 * impure: read collection continues so a state-touching impure const is
 * always an ERROR, never a silent plain const.
 */
export function runAnalysis(ctx: Ctx, programPath: ProgramPath): void {
  refreshAstAnalysis(ctx, programPath.node);
  validateLinkedImports(ctx, programPath);
  scanModuleState(ctx, programPath);
  scanComponents(ctx, programPath);
  scanTransparentSourceBindings(ctx);
  scanRefProps(ctx);
  scanRenderCallbacks(ctx);
  normalizeRenderFunctions(ctx);
  scanLocalDynamicComponentCandidates(ctx, programPath);
  scanRenderProps(ctx);
  normalizeComponentJsxValues(ctx);
  normalizeDynamicTags(ctx);
  normalizeCalculatedListSources(ctx);
  // Normalization can replace declarations and expressions. Rebuild the
  // parser-neutral index before binding-aware analysis consumes those nodes.
  refreshAstAnalysis(ctx, programPath.node);
  scanInstanceState(ctx);
  excludeRefBindings(ctx);
  // Volatility must precede derivation scanning: consts rooted at opaque
  // values ($fetch handles, external clients) qualify as per-instance
  // derivations exactly because their sources change outside the access
  // table, so their chains must replay on every pull-based update.
  scanOpaqueVolatility(ctx);
  registerTransparentSourceRoots(ctx);
  scanComputeds(ctx, programPath); // R13: after helpers are known
  scanModuleControlFlow(ctx, programPath, analyzeComputed);
  scanInstanceDerivations(ctx); // R14/R24: ordered local projections/computeds
  scanInstanceControlFlow(ctx);
  finalizeInstancePreludes(ctx);
  scanEffects(ctx, programPath);
  for (const [name] of ctx.comps) analyzeComponent(ctx, name);
  collectReads(ctx);
  foldRenderCallbackSubtreeReads(ctx);
  // acyclicity check runs unconditionally — a state-free recursive component
  // would otherwise slip past (pathVariants is only reached via the table)
  for (const [name] of ctx.comps) pathVariants(ctx, name);

  const listedComponents = new Set([
    ...ctx.listedSites.keys(),
    ...ctx.linkedComponentRows.keys(),
  ]);
  for (const comp of listedComponents) {
    if (ctx.importedComponents.has(comp)) continue;
    const sites = ctx.listedSites.get(comp) ?? [];
    const p = ctx.compPaths.get(comp)!;
    // used both as a row AND a static child: patterns would drop one usage
    if (
      (sites.length > 0 || ctx.linkedComponentRows.has(comp)) &&
      (ctx.comps.get(comp)!.parents.size > 0 ||
        (ctx.conditionalComponentSites.get(comp)?.length ?? 0) > 0)
    ) {
      throw p.buildCodeFrameError(
        `memo-dom: <${comp}> is used both as a list row and as a static child — split it into two components (R7 L1)`,
      );
    }
  }
  refreshAstAnalysis(ctx, programPath.node);
}
