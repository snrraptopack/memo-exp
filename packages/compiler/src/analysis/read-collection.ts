import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  walkAst,
  type BaseNode,
} from '../ast';
import {
  attrExpr,
  astBindingAt,
  collectStateIds,
  keyPathOf,
  memberKey,
  walkNodes,
  writeTouchesKey,
  type Ctx,
} from '../context';
import { analyzeMapSite, containsJsx, matchMapCall } from '../lists';
import { transparentListExpression } from '../lists/source-shapes';
import { analyzeCondSite } from '../conds';
import { summarizeHelper } from '../helper-summaries';
import { matchRenderCallbackMap } from '../components/render-callbacks';
import { findTargetedListDependencies } from '../lists/targeted-refresh';
import { generatedIdentifier } from '../identifiers';

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
export function collectReads(ctx: Ctx): void {
  for (const [name] of ctx.comps) {
    const p = ctx.compPaths.get(name)!;
    const reads = new Set<string>();
    const usedPrefixes = new Map<string, number>();
    const usedConds = { count: 0 };

    function registerListSource(
      site: ReturnType<typeof analyzeMapSite>,
    ): void {
      ctx.listSources.add(site.sourceKey);
      ctx.listComponents.add(name);
      if (site.sourceLocal) return;
      let sources = ctx.componentListSources.get(name);
      if (sources === undefined) {
        sources = new Set();
        ctx.componentListSources.set(name, sources);
      }
      sources.add(site.sourceKey);
    }

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
      registerListSource(site);
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
          registerListSource(nestedSite);
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
        registerListSource(site);
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
        if (node !== p.node && astFactory.isFunction(node)) return false;
        if (node.type === 'JSXAttribute') {
          const attribute = node as unknown as t.JSXAttribute;
          const attributeName = attribute.name;
        if (
            (astFactory.isJSXIdentifier(attributeName) &&
              (attributeName.name === 'ref' ||
                /^on[A-Z]/.test(attributeName.name))) ||
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
