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

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  attrExpr,
  collectStateIds,
  isConstObjectState,
  isStoreObject,
  memberKey,
  nodeHasJsx,
  registerState,
  walkNodes,
  type Ctx,
} from './context';
import { analyzeMapSite, containsJsx, matchMapCall } from './lists';
import { analyzeCondSite } from './conds';
import { summarizeHelper } from './helper-summaries';
import {
  isRenderPropReference,
  renderPropReferenceName,
} from './components/children';
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
} from './analysis/instance';
import {
  finalizeInstancePreludes,
  scanInstanceControlFlow,
} from './analysis/instance-control-flow';
import { pathVariants } from './analysis/component-graph';
import { normalizeComponentJsxValues } from './components/jsx-values';
import { normalizeRenderFunctions } from './components/render-functions';
import {
  normalizeDynamicTags,
  scanLocalDynamicComponentCandidates,
} from './jsx/dynamic-tags';
import { moduleStateStringCandidates } from './analysis/type-candidates';

export { analyzeComputed } from './analysis/computed';
export {
  componentPatterns,
  isLightweightListedComponent,
  isListLightweightCandidate,
  pathVariants,
} from './analysis/component-graph';
export { buildAccessTable } from './analysis/access-table';

/**
 * R8: a JSX-bearing conditional is allowed ONLY as a direct JSX child:
 * <div>{cond ? <A/> : <B/>}</div>. Full form validation is analyzeCondSite
 * (run in collectReads); here we only fix the position and skip the subtree.
 */
function isRenderAttributePosition(
  ctx: Ctx,
  container: NodePath<t.JSXExpressionContainer> | null | undefined,
): boolean {
  const attribute = container?.parentPath;
  if (!attribute?.isJSXAttribute()) return false;
  const opening = attribute.parentPath;
  if (!opening.isJSXOpeningElement()) return false;
  const tag = opening.node.name;
  if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return false;
  const name = attribute.node.name;
  const attrName = t.isJSXIdentifier(name) ? name.name : name.name.name;
  return (
    ctx.componentProps.get(tag.name)?.renderProps.includes(attrName) === true
  );
}

function validateCondPosition(
  ctx: Ctx,
  c: NodePath<t.ConditionalExpression> | NodePath<t.LogicalExpression>,
): void {
  const parent = c.parentPath;
  const grand = parent?.parentPath;
  if (
    !parent?.isJSXExpressionContainer() ||
    (!grand?.isJSXElement() &&
      !grand?.isJSXFragment() &&
      !isRenderAttributePosition(ctx, parent))
  ) {
    throw c.buildCodeFrameError(
      'memo-dom: conditional rendering must be a direct JSX child: <div>{cond ? <A/> : <B/>}</div>',
    );
  }
  c.skip();
}

// ---------------------------------------------------------------------
// pass 1
// ---------------------------------------------------------------------

function validateLinkedImports(ctx: Ctx, programPath: NodePath<t.Program>): void {
  for (const stmtPath of programPath.get('body')) {
    if (!stmtPath.isImportDeclaration() || stmtPath.node.importKind === 'type') continue;
    for (const spec of stmtPath.node.specifiers) {
      if (t.isImportSpecifier(spec) && spec.importKind === 'type') continue;
      const local = spec.local.name;
      if (
        ctx.importedState.has(local) ||
        ctx.importedFunctions.has(local) ||
        ctx.importedComponents.has(local)
      ) {
        continue;
      }
      throw stmtPath.buildCodeFrameError(
        `memo-dom: value import '${local}' requires compileModules() so its reactive identity can be linked`,
      );
    }
  }
}

function scanModuleState(ctx: Ctx, programPath: NodePath<t.Program>): void {
  const tagCandidates = moduleStateStringCandidates(programPath.node);
  for (const stmt of programPath.node.body) {
    // M5.5: exported state is still state — unwrap the export wrapper
    const inner = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    if (!t.isVariableDeclaration(inner)) continue;
    for (const decl of inner.declarations) {
      if (!t.isIdentifier(decl.id)) continue;
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
function scanComponents(ctx: Ctx, programPath: NodePath<t.Program>): void {
  programPath.traverse({
    FunctionDeclaration(p) {
      const name = p.node.id?.name;
      if (
        name &&
        !ctx.comps.has(name) &&
        !ctx.helpers.has(name) &&
        !ctx.jsxHelpers.has(name)
      ) {
        if (containsJsx(p)) {
          if (/^[A-Z]/.test(name)) {
            ctx.comps.set(name, { parents: new Set(), jsxCount: 0 });
            ctx.compPaths.set(name, p);
            try {
              ctx.componentProps.set(
                name,
                analyzeComponentProps(p.node.params),
              );
            } catch (error) {
              throw p.buildCodeFrameError(
                `memo-dom: invalid props for component '${name}': ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          } else {
            ctx.jsxHelpers.set(name, p);
          }
        } else {
          ctx.helpers.set(name, p);
        }
      }
      p.skip(); // nested functions are never top-level components/helpers
    },
    VariableDeclarator(p) {
      if (!p.scope.path.isProgram() || !t.isIdentifier(p.node.id)) return;
      const init = p.get('init');
      if (
        init.isArrowFunctionExpression() ||
        init.isFunctionExpression()
      ) {
        if (nodeHasJsx(init.node.body)) {
          if (!/^[A-Z]/.test(p.node.id.name)) {
            ctx.jsxHelpers.set(p.node.id.name, init);
          }
        } else {
          ctx.helpers.set(p.node.id.name, init);
        }
        init.skip();
      }
    },
  });

  // Concise JSX arrows have the JSX element as the function-body root, which
  // path-relative traversal can miss. Reconcile top-level function variables
  // directly from their raw initializer.
  for (const statementPath of programPath.get('body')) {
    const declarationPath = statementPath.isExportNamedDeclaration()
      ? statementPath.get('declaration')
      : statementPath;
    if (
      Array.isArray(declarationPath) ||
      !declarationPath.isVariableDeclaration()
    ) {
      continue;
    }
    for (const declaratorPath of declarationPath.get('declarations')) {
      if (!declaratorPath.isVariableDeclarator()) continue;
      const id = declaratorPath.node.id;
      const initPath = declaratorPath.get('init');
      if (
        !t.isIdentifier(id) ||
        /^[A-Z]/.test(id.name) ||
        Array.isArray(initPath) ||
        (!initPath.isArrowFunctionExpression() &&
          !initPath.isFunctionExpression()) ||
        !nodeHasJsx(initPath.node.body)
      ) {
        continue;
      }
      ctx.helpers.delete(id.name);
      ctx.jsxHelpers.set(id.name, initPath);
    }
  }
}

function scalarTsType(
  type: t.TSType,
  program: t.Program,
  visiting = new Set<string>(),
): boolean {
  if (
    t.isTSStringKeyword(type) ||
    t.isTSNumberKeyword(type) ||
    t.isTSBooleanKeyword(type) ||
    t.isTSBigIntKeyword(type) ||
    t.isTSSymbolKeyword(type) ||
    t.isTSNullKeyword(type) ||
    t.isTSUndefinedKeyword(type) ||
    t.isTSLiteralType(type)
  ) {
    return true;
  }
  if (t.isTSParenthesizedType(type)) {
    return scalarTsType(type.typeAnnotation, program, visiting);
  }
  if (t.isTSUnionType(type)) {
    return type.types.every((member) =>
      scalarTsType(member, program, visiting),
    );
  }
  if (t.isTSTypeReference(type) && t.isIdentifier(type.typeName)) {
    const name = type.typeName.name;
    if (visiting.has(name)) return false;
    const next = new Set(visiting);
    next.add(name);
    for (const statement of program.body) {
      const declaration = t.isExportNamedDeclaration(statement)
        ? statement.declaration
        : statement;
      if (
        t.isTSTypeAliasDeclaration(declaration) &&
        declaration.id.name === name
      ) {
        return scalarTsType(declaration.typeAnnotation, program, next);
      }
    }
  }
  return false;
}

function declaredScalarProp(
  componentPath: NodePath<t.FunctionDeclaration>,
  prop: string,
): boolean {
  const scalarDefault = (expression: t.Expression): boolean =>
    t.isStringLiteral(expression) ||
    t.isNumericLiteral(expression) ||
    t.isBooleanLiteral(expression) ||
    t.isBigIntLiteral(expression) ||
    (t.isUnaryExpression(expression) &&
      (expression.operator === '+' || expression.operator === '-') &&
      t.isNumericLiteral(expression.argument));
  for (const parameter of componentPath.node.params) {
    if (t.isTSParameterProperty(parameter)) continue;
    if (
      t.isAssignmentPattern(parameter) &&
      t.isIdentifier(parameter.left, { name: prop }) &&
      scalarDefault(parameter.right)
    ) {
      return true;
    }
    if (
      t.isAssignmentPattern(parameter) &&
      t.isObjectPattern(parameter.left) &&
      t.isObjectExpression(parameter.right)
    ) {
      const defaultProperty = parameter.right.properties.find((property) => {
        if (!t.isObjectProperty(property) || property.computed) return false;
        const name = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : null;
        return name === prop;
      });
      if (
        t.isObjectProperty(defaultProperty) &&
        t.isExpression(defaultProperty.value) &&
        scalarDefault(defaultProperty.value)
      ) {
        return true;
      }
    }
    const parameterTarget = t.isAssignmentPattern(parameter)
      ? parameter.left
      : parameter;
    if (!t.isObjectPattern(parameterTarget)) continue;
    for (const property of parameterTarget.properties) {
      if (!t.isObjectProperty(property) || property.computed) continue;
      const name = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null;
      if (
        name === prop &&
        t.isAssignmentPattern(property.value) &&
        scalarDefault(property.value.right)
      ) {
        return true;
      }
    }
  }

  const first = componentPath.node.params[0];
  if (first == null || t.isTSParameterProperty(first)) return false;
  const target = t.isAssignmentPattern(first) ? first.left : first;
  if (
    !t.isIdentifier(target) &&
    !t.isObjectPattern(target) &&
    !t.isArrayPattern(target)
  ) {
    return false;
  }
  const annotation = target.typeAnnotation;
  if (!t.isTSTypeAnnotation(annotation)) return false;
  const program = componentPath.findParent((path) => path.isProgram());
  if (!program?.isProgram()) return false;

  let shape = annotation.typeAnnotation;
  if (t.isTSTypeReference(shape) && t.isIdentifier(shape.typeName)) {
    const referenceName = shape.typeName.name;
    const declaration = program.node.body
      .map((statement) =>
        t.isExportNamedDeclaration(statement)
          ? statement.declaration
          : statement,
      )
      .find(
        (candidate) =>
          (t.isTSInterfaceDeclaration(candidate) ||
            t.isTSTypeAliasDeclaration(candidate)) &&
          candidate.id.name === referenceName,
      );
    if (t.isTSInterfaceDeclaration(declaration)) {
      shape = t.tsTypeLiteral(declaration.body.body);
    } else if (t.isTSTypeAliasDeclaration(declaration)) {
      shape = declaration.typeAnnotation;
    }
  }
  if (!t.isTSTypeLiteral(shape)) return false;
  for (const member of shape.members) {
    if (!t.isTSPropertySignature(member) || member.computed) continue;
    const name = t.isIdentifier(member.key)
      ? member.key.name
      : t.isStringLiteral(member.key)
        ? member.key.value
        : null;
    if (
      name === prop &&
      t.isTSTypeAnnotation(member.typeAnnotation)
    ) {
      return scalarTsType(
        member.typeAnnotation.typeAnnotation,
        program.node,
      );
    }
  }
  return false;
}

function expressionCarriesJsx(
  path: NodePath,
  visiting = new Set<t.Node>(),
): boolean {
  if (nodeHasJsx(path.node)) return true;
  if (visiting.has(path.node)) return false;
  visiting.add(path.node);
  if (path.isIdentifier()) {
    const binding = path.scope.getBinding(path.node.name);
    if (binding?.path.isVariableDeclarator()) {
      const init = binding.path.get('init');
      return !Array.isArray(init) && init.node != null
        ? expressionCarriesJsx(init, visiting)
        : false;
    }
  }
  if (path.isMemberExpression()) {
    const object = path.get('object');
    return !Array.isArray(object) && expressionCarriesJsx(object, visiting);
  }
  return false;
}

/**
 * Discover props that are consumed as mount slots. Direct JSX-child use is
 * the defining contract; forwarding through another declared render prop is
 * propagated to a fixed point for wrapper components.
 */
function scanRenderProps(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const plan = ctx.componentProps.get(name)!;
    componentPath.traverse({
      JSXExpressionContainer(path) {
        if (
          !path.parentPath?.isJSXElement() &&
          !path.parentPath?.isJSXFragment()
        ) {
          return;
        }
        const expression = path.node.expression;
        if (!t.isExpression(expression)) return;
        const prop = renderPropReferenceName(ctx, name, expression);
        if (prop === null) return;
        const parent = path.parentPath;
        const meaningful = parent.isJSXElement()
          ? parent.node.children.filter(
              (child) => !t.isJSXText(child) || child.value.trim() !== '',
            )
          : [path.node];
        if (
          (prop === 'children' || meaningful.length === 1) &&
          !declaredScalarProp(componentPath, prop) &&
          !plan.renderProps.includes(prop)
        ) {
          plan.renderProps.push(prop);
        }
      },
    });
  }

  // A local scalar call disambiguates an otherwise-untyped sole
  // interpolation (`<strong>{label}</strong>`) as ordinary text.
  for (const [owner, ownerPath] of ctx.compPaths) {
    ownerPath.traverse({
      JSXElement(path) {
        const tag = path.node.openingElement.name;
        if (!t.isJSXIdentifier(tag) || !ctx.comps.has(tag.name)) return;
        const target = ctx.componentProps.get(tag.name)!;
        for (const attributePath of path.get('openingElement').get('attributes')) {
          if (!attributePath.isJSXAttribute()) continue;
          const name = attributePath.node.name;
          const prop = t.isJSXIdentifier(name) ? name.name : name.name.name;
          if (!target.renderProps.includes(prop)) continue;
          const value = attributePath.get('value');
          if (
            value.isJSXExpressionContainer() &&
            t.isExpression(value.node.expression)
          ) {
            const expressionPath = value.get('expression');
            if (
              !Array.isArray(expressionPath) &&
              (expressionCarriesJsx(expressionPath) ||
                (t.isExpression(expressionPath.node) &&
                  renderPropReferenceName(
                    ctx,
                    owner,
                    expressionPath.node,
                  ) !== null))
            ) {
              continue;
            }
          }
          target.renderProps = target.renderProps.filter(
            (candidate) => candidate !== prop,
          );
        }
      },
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, componentPath] of ctx.compPaths) {
      const plan = ctx.componentProps.get(name)!;
      componentPath.traverse({
        JSXAttribute(path) {
          const container = path.get('value');
          if (
            !container.isJSXExpressionContainer() ||
            !t.isExpression(container.node.expression)
          ) {
            return;
          }
          const sourceProp = renderPropReferenceName(
            ctx,
            name,
            container.node.expression,
          );
          if (sourceProp === null || plan.renderProps.includes(sourceProp)) {
            return;
          }
          const opening = path.parentPath;
          if (!opening.isJSXOpeningElement()) return;
          const tag = opening.node.name;
          if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
          const target = ctx.componentProps.get(tag.name);
          const attr = path.node.name;
          const attrName = t.isJSXIdentifier(attr) ? attr.name : attr.name.name;
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
  const renderPropUses = new Map<string, number>();
  p.traverse({
    JSXElement(el) {
      const open = el.node.openingElement;
      if (!t.isJSXIdentifier(open.name)) {
        throw el.buildCodeFrameError(
          'memo-dom: namespaced or member-expression JSX tags are not supported (L1)',
        );
      }
      // key is region metadata — meaningless (and misleading) elsewhere
      for (const attr of open.attributes) {
        if (!t.isJSXSpreadAttribute(attr) && (attr.name as t.JSXIdentifier).name === 'key') {
          throw el.buildCodeFrameError(
            'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
          );
        }
      }
      const tag = open.name.name;
      if (/^[A-Z]/.test(tag)) {
        const localComponent = ctx.comps.has(tag);
        if (!localComponent && !ctx.importedComponents.has(tag)) {
          throw el.buildCodeFrameError(
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
        // Nested syntax is a lexical content slot owned by this component.
        // Continue into it to discover and validate the authored subtree.
        return;
      }
      info.jsxCount++;
    },
    JSXExpressionContainer(container) {
      const expression = container.node.expression;
      if (
        !t.isExpression(expression) ||
        !isRenderPropReference(ctx, name, expression)
      ) {
        return;
      }
      const prop = renderPropReferenceName(ctx, name, expression)!;
      const uses = (renderPropUses.get(prop) ?? 0) + 1;
      renderPropUses.set(prop, uses);
      if (uses > 1) {
        throw container.buildCodeFrameError(
          `memo-dom: render prop '${prop}' can only be rendered or forwarded once`,
        );
      }
      const parent = container.parentPath;
      if (!parent.isJSXElement()) return;
      const tag = parent.node.openingElement.name;
      if (t.isJSXIdentifier(tag) && !/^[A-Z]/.test(tag.name)) {
        const meaningful = parent.node.children.filter(
          (child) => !t.isJSXText(child) || child.value.trim() !== '',
        );
        if (meaningful.length !== 1) {
          throw container.buildCodeFrameError(
            `memo-dom: render prop '${prop}' must be the sole child of its host insertion element`,
          );
        }
      }
    },
    ConditionalExpression(c) {
      if (containsJsx(c)) validateCondPosition(ctx, c);
    },
    LogicalExpression(l) {
      if (containsJsx(l)) {
        if (l.node.operator !== '&&' && l.node.operator !== '||') {
          throw l.buildCodeFrameError(
            'memo-dom: only && / || conditionals are supported (R8 L1), not ??',
          );
        }
        validateCondPosition(ctx, l);
      }
    },
    CallExpression(call) {
      const mapCall = matchMapCall(call.node);
      if (mapCall && containsJsx(call)) {
        // allowed ONLY as a direct JSX child: <ul>{items.map(...)}</ul>
        const parent = call.parentPath;
        const grand = parent?.parentPath;
        if (
          !parent?.isJSXExpressionContainer() ||
          (!grand?.isJSXElement() &&
            !grand?.isJSXFragment() &&
            !isRenderAttributePosition(ctx, parent))
        ) {
          throw call.buildCodeFrameError(
            'memo-dom: list rendering must be a direct JSX child: <ul>{items.map(item => <Row />)}</ul>',
          );
        }
        // full form validation happens in collectReads (needs composition)
        call.skip();
      }
    },
  });
}

// ---------------------------------------------------------------------
// shared read/write classifiers
// ---------------------------------------------------------------------

/** Is this complete member expression being invoked (`store.items.method()`)? */
function isMemberCallCallee(m: NodePath<t.MemberExpression>): boolean {
  const parent = m.parentPath;
  return parent.isCallExpression() && parent.node.callee === m.node;
}

/**
 * The dotted read key of a store member expression ('store.items.length'),
 * or null when it is not a read (write target, method callee, non-store).
 */
function storeReadKey(ctx: Ctx, m: NodePath<t.MemberExpression>): string | null {
  const key = memberKey(m.node);
  if (!key || !key.includes('.')) return null;
  const rootName = key.split('.')[0]!;
  if (ctx.state.get(rootName) !== 'store') return null;
  if (m.scope.getBinding(rootName)?.scope.path.isProgram() !== true) return null;
  const parent = m.parentPath;
  if (
    parent.isAssignmentExpression({ operator: '=' }) &&
    parent.node.left === m.node
  ) {
    return null; // write target, not a read
  }
  if (isMemberCallCallee(m)) return null; // the object chain registers itself
  return key;
}

// ---------------------------------------------------------------------
// reads per component (with list + helper attribution)
// ---------------------------------------------------------------------

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
      call: NodePath<t.CallExpression>,
      condSuffix: string,
      branchPrefixes: Map<string, number>,
    ): void {
      const mapCall = matchMapCall(call.node);
      if (mapCall === null || !containsJsx(call)) return;
      const site = analyzeMapSite(
        ctx,
        mapCall,
        call,
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
      call.skip();
    }

    function recordConditionalComponent(
      element: NodePath<t.JSXElement>,
      condSuffix: string,
      childCounts: Map<string, number>,
    ): void {
      const tag = element.node.openingElement.name;
      if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
      if (!ctx.comps.has(tag.name) && !ctx.importedComponents.has(tag.name)) {
        throw element.buildCodeFrameError(
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
      element: NodePath<t.JSXElement>,
      containerSuffix: string,
      childCounts: Map<string, number>,
    ): void {
      const tag = element.node.openingElement.name;
      if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
      if (!ctx.comps.has(tag.name) && !ctx.importedComponents.has(tag.name)) {
        throw element.buildCodeFrameError(
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
      call: NodePath<t.CallExpression>,
      site: ReturnType<typeof analyzeMapSite>,
      containerSuffix: string,
    ): void {
      const callbackPath = call.get('arguments')[0];
      if (callbackPath === undefined) return;
      const rowVars = new Set<string>();
      const childCounts = new Map<string, number>();
      const nestedPrefixes = new Map<string, number>();

      callbackPath.traverse({
        Identifier(id) {
          if (
            id.node.name !== site.itemParam &&
            ctx.state.has(id.node.name) &&
            id.scope.getBinding(id.node.name)?.scope.path.isProgram() === true
          ) {
            rowVars.add(id.node.name);
          }
        },
        JSXElement(element) {
          recordRowComponent(element, containerSuffix, childCounts);
        },
        CallExpression(inner) {
          const nestedMap = matchMapCall(inner.node);
          if (nestedMap !== null && containsJsx(inner)) {
            const nestedSite = analyzeMapSite(
              ctx,
              nestedMap,
              inner,
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
            inner.skip();
            return;
          }
          const callee = inner.node.callee;
          if (
            t.isIdentifier(callee) &&
            (ctx.helpers.has(callee.name) ||
              ctx.importedFunctions.has(callee.name))
          ) {
            const summary =
              ctx.importedFunctions.get(callee.name) ??
              summarizeHelper(ctx, callee.name);
            for (const read of summary.reads) rowVars.add(read);
          }
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
      c: NodePath<t.ConditionalExpression> | NodePath<t.LogicalExpression>,
      parentSuffix: string | null = null,
    ): void {
      const node = c.node;
      if (!containsJsx(c)) return; // attribute ternaries etc.: plain reads
      const site = analyzeCondSite(node, c, usedConds);
      const fullSuffix =
        parentSuffix === null
          ? site.suffix
          : `${parentSuffix}/${site.suffix}`;
      const branchPaths: NodePath[] = [];
      if (c.isConditionalExpression()) {
        let current = c as NodePath;
        while (current.isConditionalExpression()) {
          branchPaths.push(current.get('consequent') as NodePath);
          current = current.get('alternate') as NodePath;
        }
        branchPaths.push(current);
      } else {
        branchPaths.push(c.get('right') as NodePath);
      }
      for (const branchPath of branchPaths) {
        const branchPrefixes = new Map<string, number>();
        const branchChildren = new Map<string, number>();
        if (
          (branchPath.isConditionalExpression() ||
            branchPath.isLogicalExpression()) &&
          containsJsx(branchPath)
        ) {
          handleCond(
            branchPath as
              | NodePath<t.ConditionalExpression>
              | NodePath<t.LogicalExpression>,
            fullSuffix,
          );
          continue;
        }
        if (branchPath.isJSXElement()) {
          recordConditionalComponent(
            branchPath,
            fullSuffix,
            branchChildren,
          );
        }
        branchPath.traverse({
          ConditionalExpression(inner) {
            if (!containsJsx(inner)) return;
            handleCond(inner, fullSuffix);
            inner.skip();
          },
          LogicalExpression(inner) {
            if (!containsJsx(inner)) return;
            handleCond(inner, fullSuffix);
            inner.skip();
          },
          JSXElement(element) {
            recordConditionalComponent(
              element,
              fullSuffix,
              branchChildren,
            );
          },
          CallExpression(call) {
            collectConditionalMap(
              call,
              fullSuffix,
              branchPrefixes,
            );
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
      c.skip(); // region reads are not owner reads
    }

    p.traverse({
      ConditionalExpression(c) {
        handleCond(c);
      },
      LogicalExpression(l) {
        handleCond(l);
      },
      CallExpression(call) {
        if (
          t.isIdentifier(call.node.callee, { name: 'effect' }) &&
          call.scope.getBinding('effect') === undefined
        ) {
          // Effect reads belong to the effect entity, not its owner.
          call.skip();
          return;
        }
        const mapCall = matchMapCall(call.node);
        if (mapCall && containsJsx(call)) {
          const site = analyzeMapSite(ctx, mapCall, call, name, usedPrefixes);
          if (!site.sourceLocal) reads.add(site.sourceKey);
          if (site.form === 'component') {
            // R10: row-prop reads are OWNER reads — the owner re-pushes row
            // props via updateProps during reconcile
            for (const attr of site.jsx.openingElement.attributes) {
              if (t.isJSXSpreadAttribute(attr)) continue;
              const a = attr as t.JSXAttribute;
              if ((a.name as t.JSXIdentifier).name === 'key') continue;
              const v = attrExpr(a.value);
              if (!v) continue;
              walkNodes(v, (n) => {
                if (
                  t.isIdentifier(n) &&
                  ctx.state.has(n.name) &&
                  call.scope.getBinding(n.name)?.scope.path.isProgram() === true
                ) {
                  reads.add(n.name);
                }
                if (t.isMemberExpression(n)) {
                  const key = memberKey(n);
                  if (key !== null && key.includes('.')) {
                    const rootName = key.split('.')[0]!;
                    if (
                      ctx.state.get(rootName) === 'store' &&
                      call.scope.getBinding(rootName)?.scope.path.isProgram() === true
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
          call.skip(); // callback contents are not owner reads
          return;
        }
        // helper calls: the callee's summarized reads belong to this component
        const callee = call.node.callee;
        if (
          t.isIdentifier(callee) &&
          (ctx.helpers.has(callee.name) || ctx.importedFunctions.has(callee.name)) &&
          call.scope.getBinding(callee.name)?.scope.path.isProgram() === true
        ) {
          const summary =
            ctx.importedFunctions.get(callee.name) ?? summarizeHelper(ctx, callee.name);
          for (const r of summary.reads) reads.add(r);
        }
      },

      Identifier(id) {
        if (!ctx.state.has(id.node.name)) return;
        // Static-table keys identify module bindings, not same-spelled props,
        // instance state, or local derivations.
        if (id.scope.getBinding(id.node.name)?.scope.path.isProgram() !== true) return;
        const parent = id.parentPath;
        if (
          parent.isAssignmentExpression({ operator: '=' }) &&
          parent.node.left === id.node
        ) {
          return; // write target, not a read
        }
        reads.add(id.node.name);
      },
      MemberExpression(m) {
        const key = storeReadKey(ctx, m);
        if (key !== null) reads.add(key);
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
export function runAnalysis(ctx: Ctx, programPath: NodePath<t.Program>): void {
  validateLinkedImports(ctx, programPath);
  scanModuleState(ctx, programPath);
  scanComponents(ctx, programPath);
  normalizeRenderFunctions(ctx);
  scanLocalDynamicComponentCandidates(ctx, programPath);
  scanRenderProps(ctx);
  normalizeComponentJsxValues(ctx);
  normalizeDynamicTags(ctx);
  scanInstanceState(ctx);
  scanComputeds(ctx, programPath); // R13: after helpers are known
  scanModuleControlFlow(ctx, programPath, analyzeComputed);
  scanInstanceDerivations(ctx); // R14/R24: ordered local projections/computeds
  scanInstanceControlFlow(ctx);
  finalizeInstancePreludes(ctx);
  scanEffects(ctx, programPath);
  for (const [name] of ctx.comps) analyzeComponent(ctx, name);
  collectReads(ctx);
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
}
