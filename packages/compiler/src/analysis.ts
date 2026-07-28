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
 * Also owns pathVariants (every static path a component can live at),
 * componentPatterns (including listed-row sites) and buildAccessTable
 * (Program.exit). Module helper effects live in helper-summaries.ts.
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
  canonicalStateKey,
  collectStateIds,
  isConstObjectState,
  isStoreObject,
  memberKey,
  memberRootName,
  registerState,
  walkNodes,
  type Ctx,
  type ComputedAnalysis,
} from './context';
import { md } from './identifiers';
import { analyzeMapSite, containsJsx, matchMapCall } from './lists';
import { analyzeCondSite } from './conds';
import { summarizeHelper } from './helper-summaries';
import { isChildrenReference } from './components/children';
import {
  analyzeComponentProps,
  bindingNames,
  type ControlFlowDerivation,
  type LocalDerivation,
} from './components/props';
import { scanEffects } from './effects';
import { scanModuleControlFlow } from './module-control-flow';

/**
 * R8: a JSX-bearing conditional is allowed ONLY as a direct JSX child:
 * <div>{cond ? <A/> : <B/>}</div>. Full form validation is analyzeCondSite
 * (run in collectReads); here we only fix the position and skip the subtree.
 */
function validateCondPosition(
  c: NodePath<t.ConditionalExpression> | NodePath<t.LogicalExpression>,
): void {
  const parent = c.parentPath;
  const grand = parent?.parentPath;
  if (
    !parent?.isJSXExpressionContainer() ||
    (!grand?.isJSXElement() && !grand?.isJSXFragment())
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
      if (name && !ctx.comps.has(name) && !ctx.helpers.has(name)) {
        if (containsJsx(p)) {
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
          ctx.helpers.set(name, p);
        }
      }
      p.skip(); // nested functions are never top-level components/helpers
    },
    VariableDeclarator(p) {
      if (!p.scope.path.isProgram() || !t.isIdentifier(p.node.id)) return;
      const init = p.get('init');
      if (
        (init.isArrowFunctionExpression() || init.isFunctionExpression()) &&
        !containsJsx(init)
      ) {
        ctx.helpers.set(p.node.id.name, init);
        init.skip();
      }
    },
  });
}

/**
 * Every static path variant at which instances of `name` can live: walks ALL
 * parents (multi-parent components) and expands repeated edges into '[*]'
 * variants. Cycle-safe: recursive components throw.
 */
export function pathVariants(
  ctx: Ctx,
  name: string,
  visiting: Set<string> = new Set(),
): string[] {
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) return [...linked];
  if (visiting.has(name)) {
    throw ctx.compPaths.get(name)!.buildCodeFrameError(
      `memo-dom: recursive component '${name}' — components cannot render themselves (L1)`,
    );
  }
  const listedSites = ctx.listedSites.get(name);
  if (listedSites !== undefined && listedSites.length > 0) {
    visiting.add(name);
    const out = listedSites.flatMap((site) =>
      pathVariants(ctx, site.owner, visiting).map(
        (ownerPath) =>
          `${ownerPath}/${site.suffix}/Row[*]`,
      ),
    );
    visiting.delete(name);
    return [...new Set(out)];
  }
  const info = ctx.comps.get(name)!;
  const conditionalSites = ctx.conditionalComponentSites.get(name) ?? [];
  if (info.parents.size === 0 && conditionalSites.length === 0) {
    return [ctx.rootId];
  }
  visiting.add(name);
  const out: string[] = [];
  for (const site of conditionalSites) {
    for (const ownerPath of pathVariants(ctx, site.owner, visiting)) {
      out.push(`${ownerPath}/${site.suffix}`);
    }
  }
  for (const parent of info.parents) {
    const count = ctx.childRefCounts.get(parent)?.get(name) ?? 1;
    for (const pp of pathVariants(ctx, parent, visiting)) {
      if (count > 1) out.push(`${pp}/${name}`, `${pp}/${name}[*]`);
      else out.push(`${pp}/${name}`);
    }
  }
  visiting.delete(name);
  return out;
}

/**
 * Per component: wire the composition graph, count host elements, and
 * reject (or, for R7, validate) every construct with actionable errors.
 */
function analyzeComponent(ctx: Ctx, name: string): void {
  const p = ctx.compPaths.get(name)!;
  const info = ctx.comps.get(name)!;
  let childrenUses = 0;
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
        !isChildrenReference(ctx, name, expression)
      ) {
        return;
      }
      childrenUses++;
      if (childrenUses > 1) {
        throw container.buildCodeFrameError(
          'memo-dom: a component children slot can only be rendered or forwarded once',
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
            'memo-dom: a component children slot must be the sole child of its host insertion element',
          );
        }
      }
    },
    ConditionalExpression(c) {
      if (containsJsx(c)) validateCondPosition(c);
    },
    LogicalExpression(l) {
      if (containsJsx(l)) {
        if (l.node.operator !== '&&' && l.node.operator !== '||') {
          throw l.buildCodeFrameError(
            'memo-dom: only && / || conditionals are supported (R8 L1), not ??',
          );
        }
        validateCondPosition(l);
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
          (!grand?.isJSXElement() && !grand?.isJSXFragment())
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
        const rowVars = new Set<string>();
        const cbPath = call.get('arguments')[0];
        cbPath?.traverse({
          Identifier(id) {
            if (
              id.node.name !== site.itemParam &&
              ctx.state.has(id.node.name) &&
              id.scope.getBinding(id.node.name)?.scope.path.isProgram() === true
            ) {
              rowVars.add(id.node.name);
            }
          },
          CallExpression(inner) {
            const callee = inner.node.callee;
            if (t.isIdentifier(callee) && ctx.helpers.has(callee.name)) {
              for (const read of summarizeHelper(ctx, callee.name).reads) {
                rowVars.add(read);
              }
            }
          },
        });
        if (rowVars.size > 0) {
          ctx.rowReads.set(`${name}/${nestedSuffix}`, {
            owner: name,
            suffix: nestedSuffix,
            vars: rowVars,
          });
        }
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
            // reads inside the ROW belong to the row pattern — traverse the
            // callback only, never the callee (the array is an owner read)
            const rowVars = new Set<string>();
            const cbPath = call.get('arguments')[0];
            cbPath?.traverse({
              Identifier(id) {
                if (
                  id.node.name !== site.itemParam &&
                  ctx.state.has(id.node.name) &&
                  id.scope.getBinding(id.node.name)?.scope.path.isProgram() === true
                ) {
                  rowVars.add(id.node.name);
                }
              },
              CallExpression(inner) {
                const c = inner.node.callee;
                if (t.isIdentifier(c) && ctx.helpers.has(c.name)) {
                  for (const r of summarizeHelper(ctx, c.name).reads) rowVars.add(r);
                }
              },
            });
            if (rowVars.size > 0) {
              ctx.rowReads.set(`${name}/${site.suffix}`, {
                owner: name,
                suffix: site.suffix,
                vars: rowVars,
              });
            }
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
export function analyzeComputed(ctx: Ctx, expr: t.Node): ComputedAnalysis {
  const reads = new Set<string>();
  let impure = false;
  let reason: string | undefined;
  const locals = new Set<string>();
  const fail = (r: string): void => {
    if (!impure) {
      impure = true;
      reason = r;
    }
  };
  const noteLocalPattern = (id: t.LVal): void => {
    if (t.isIdentifier(id)) locals.add(id.name);
    else {
      walkNodes(id, (n) => {
        if (t.isIdentifier(n)) locals.add(n.name);
      });
    }
  };
  walkNodes(expr, (n, parent) => {
    if (t.isFunction(n)) {
      const executesAsPartOfExpression =
        parent !== null &&
        (t.isCallExpression(parent) || t.isNewExpression(parent));
      if (!executesAsPartOfExpression) return false;
      for (const p of n.params) {
        if (t.isLVal(p)) noteLocalPattern(p);
      }
      return;
    }
    if (t.isVariableDeclarator(n) && t.isLVal(n.id)) {
      noteLocalPattern(n.id);
      return;
    }
    if (t.isAssignmentExpression(n)) {
      const root = t.isIdentifier(n.left)
        ? n.left.name
        : t.isMemberExpression(n.left)
          ? memberRootName(n.left)
          : null;
      if (root === null || !locals.has(root)) {
        fail('contains an assignment — writes belong in handlers, not derivations');
      }
      return;
    }
    if (t.isUpdateExpression(n)) {
      const a = n.argument;
      const root = t.isIdentifier(a)
        ? a.name
        : t.isMemberExpression(a)
          ? memberRootName(a)
          : null;
      if (root === null || !locals.has(root)) {
        fail('contains an update (++/--) — writes belong in handlers, not derivations');
      }
      return;
    }
    if (t.isAwaitExpression(n) || t.isYieldExpression(n)) {
      fail('uses await/yield — derivations must be synchronous');
      return;
    }
    if (t.isCallExpression(n)) {
      const c = n.callee;
      if (
        t.isIdentifier(c) &&
        (ctx.helpers.has(c.name) || ctx.importedFunctions.has(c.name))
      ) {
        const sum = ctx.importedFunctions.get(c.name) ?? summarizeHelper(ctx, c.name);
        for (const r of sum.reads) reads.add(r);
        if (sum.writes.size > 0) {
          for (const w of sum.writes) reads.add(w); // ensure the error triggers
          fail(`calls helper '${c.name}' which writes state — writes belong in handlers`);
        } else if (sum.unbounded && ctx.helpers.has(c.name)) {
          fail(`calls recursive helper '${c.name}' which cannot be analyzed`);
        }
      }
      // unknown / imported / global functions are fine — detection is by
      // state REFERENCE; what they compute is the author's responsibility
      return;
    }
    if (t.isIdentifier(n)) {
      if (!locals.has(n.name) && ctx.state.has(n.name)) reads.add(n.name);
      return;
    }
    if (t.isMemberExpression(n) && !n.computed) {
      const key = memberKey(n);
      if (key !== null && key.includes('.')) {
        const root = key.split('.')[0]!;
        if (!locals.has(root) && ctx.state.get(root) === 'store') reads.add(key);
      }
    }
  });
  return { reads, impure, reason };
}

/**
 * R13: second-pass computed detection (needs the COMPLETE state map, so it
 * runs after scanModuleState). A module-level `const x = <expression
 * referencing state>` becomes a computed; a const that references state
 * while WRITING/MUTATING it (or awaiting) is a compile error — never a
 * silent plain const. Declared in order, so later computeds may read
 * earlier ones (chains).
 */
function scanComputeds(ctx: Ctx, programPath: NodePath<t.Program>): void {
  for (const stmt of programPath.node.body) {
    const inner = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    if (!t.isVariableDeclaration(inner) || inner.kind !== 'const') continue;
    for (const decl of inner.declarations) {
      if (!t.isIdentifier(decl.id) || decl.init == null) continue;
      const name = decl.id.name;
      // A collection/object literal that references earlier state is a
      // derivation, not independently mutable state. Detection-by-reference
      // takes precedence over the initializer-shape classification.
      if (ctx.state.get(name) === 'let' || ctx.state.get(name) === 'computed') continue;
      if (t.isFunction(decl.init) || t.isJSX(decl.init)) continue; // not data
      const r = analyzeComputed(ctx, decl.init);
      if (r.impure) {
        if (r.reads.size > 0) {
          throw new Error(
            `memo-dom: const '${name}' is a state derivation but ${r.reason ?? 'cannot be analyzed'}. ` +
              `Fix the derivation, or make it a 'let' you update in handlers.`,
          );
        }
        continue; // impure but touches no state — a plain const
      }
      if (r.reads.size === 0) continue; // constant expression — plain const
      registerState(ctx, name, 'computed');
      ctx.computeds.set(name, { reads: r.reads });
    }
  }
}

/**
 * R12: collect instance state — top-level let/var declarations of each
 * component body (the factory closure of ONE instance). Runs before
 * collectReads so instance names shadow module state in read attribution.
 */
function scanInstanceState(ctx: Ctx): void {
  for (const [name, p] of ctx.compPaths) {
    const vars = new Set<string>();
    for (const stmt of p.node.body.body) {
      if (!t.isVariableDeclaration(stmt)) continue;
      if (stmt.kind !== 'let' && stmt.kind !== 'var' && stmt.kind !== 'const') continue;
      for (const d of stmt.declarations) {
        if (!t.isIdentifier(d.id)) continue;
        if (
          stmt.kind === 'let' ||
          stmt.kind === 'var' ||
          isStoreObject(d.init) ||
          isConstObjectState(d.init)
        ) {
          vars.add(d.id.name);
        }
      }
    }
    if (vars.size > 0) ctx.instanceState.set(name, vars);
  }
}

/**
 * R14: discover top-level component consts derived from instance state,
 * reactive props, module state, or an earlier local derivation.
 *
 * Local derivations are deliberately cheaper than R13 module computeds:
 * the owner is already the exact invalidation unit, so update() recomputes
 * them in source order before guarded DOM writes. No entity, write-set, or
 * runtime dependency edge is needed.
 */
function scanInstanceDerivations(ctx: Ctx): void {
  for (const [compName, compPath] of ctx.compPaths) {
    const reactiveBindings = new Map<unknown, string>();

    for (const name of ctx.componentProps.get(compName)?.bindings ?? []) {
      const binding = compPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(compName) ?? []) {
      const binding = compPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = compPath.scope.getBinding(name);
      if (binding?.scope.path.isProgram()) {
        reactiveBindings.set(binding, name);
      }
    }

    const derivations: LocalDerivation[] = [];
    const derivedBindings = new Set<string>();
    const derivedSources = new Map<string, Set<string>>();
    const statements = compPath.get('body').get('body');
    for (const stmtPath of statements) {
      if (!stmtPath.isVariableDeclaration({ kind: 'const' })) continue;
      for (const declPath of stmtPath.get('declarations')) {
        const decl = declPath.node;
        if (
          (!t.isIdentifier(decl.id) &&
            !t.isObjectPattern(decl.id) &&
            !t.isArrayPattern(decl.id)) ||
          decl.init == null ||
          t.isFunction(decl.init)
        ) {
          continue;
        }
        if (
          t.isIdentifier(decl.id) &&
          ctx.instanceState.get(compName)?.has(decl.id.name) === true &&
          (isStoreObject(decl.init) || isConstObjectState(decl.init))
        ) {
          continue;
        }
        const initPath = declPath.get('init');
        if (!initPath.isExpression()) continue;

        const directReads = new Set<string>();
        let reason: string | null = null;
        const bindingIsReactive = (name: string, at: NodePath): boolean => {
          const binding = at.scope.getBinding(name);
          return binding !== undefined && reactiveBindings.has(binding);
        };
        const noteIdentifier = (p: NodePath): void => {
          if (!t.isIdentifier(p.node)) return;
          const binding = p.scope.getBinding(p.node.name);
          const source =
            binding === undefined
              ? undefined
              : reactiveBindings.get(binding);
          if (source !== undefined) {
            directReads.add(source);
          }
        };
        const mutationRoot = (node: t.Node): string | null =>
          t.isIdentifier(node)
            ? node.name
            : t.isMemberExpression(node)
              ? memberRootName(node)
              : null;
        if (initPath.isReferencedIdentifier()) noteIdentifier(initPath);
        if (initPath.isAssignmentExpression()) {
          const root = mutationRoot(initPath.node.left);
          if (root !== null && bindingIsReactive(root, initPath)) {
            reason = 'contains an assignment to reactive state';
          }
        } else if (initPath.isUpdateExpression()) {
          const root = mutationRoot(initPath.node.argument);
          if (root !== null && bindingIsReactive(root, initPath)) {
            reason = 'contains an update (++/--) to reactive state';
          }
        } else if (initPath.isAwaitExpression()) {
          reason = 'uses await; per-instance derivations must be synchronous';
        } else if (initPath.isYieldExpression()) {
          reason = 'uses yield; per-instance derivations must be synchronous';
        }
        initPath.traverse({
          Function(fn) {
            // A deferred callback captures reactive bindings but does not make
            // the setup call's return value a derivation. Lifecycle analysis
            // instruments the callback in its own execution scope.
            fn.skip();
          },
          ReferencedIdentifier(p) {
            noteIdentifier(p);
          },
          AssignmentExpression(p) {
            const root = mutationRoot(p.node.left);
            if (root !== null && bindingIsReactive(root, p)) {
              reason = 'contains an assignment to reactive state';
            }
          },
          UpdateExpression(p) {
            const root = mutationRoot(p.node.argument);
            if (root !== null && bindingIsReactive(root, p)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          },
          AwaitExpression() {
            reason = 'uses await; per-instance derivations must be synchronous';
          },
          YieldExpression() {
            reason = 'uses yield; per-instance derivations must be synchronous';
          },
        });

        if (directReads.size === 0) continue;
        // A callback-only reference does not make setup work such as
        // setInterval() a derivation. Once an outer read proves this is a
        // derivation, however, synchronous callbacks such as filter/map and
        // unknown call contracts may contribute dependencies and writes.
        initPath.traverse({
          ReferencedIdentifier(p) {
            noteIdentifier(p);
          },
          AssignmentExpression(p) {
            const root = mutationRoot(p.node.left);
            if (root !== null && bindingIsReactive(root, p)) {
              reason = 'contains an assignment to reactive state';
            }
          },
          UpdateExpression(p) {
            const root = mutationRoot(p.node.argument);
            if (root !== null && bindingIsReactive(root, p)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          },
        });
        if (reason !== null) {
          const names = bindingNames(decl.id);
          throw declPath.buildCodeFrameError(
            `memo-dom: local const '${
              names.join(', ') || '<pattern>'
            }' is a per-instance derivation but ${reason}`,
          );
        }
        const names = bindingNames(decl.id);
        const sources = new Set<string>();
        for (const read of directReads) {
          const upstream = derivedSources.get(read);
          if (upstream === undefined) sources.add(read);
          else for (const source of upstream) sources.add(source);
        }
        derivations.push({
          declaration: stmtPath.node,
          target: t.cloneNode(decl.id),
          source: t.cloneNode(decl.init),
          bindings: names,
          sources: [...sources].sort(),
        });
        for (const name of names) {
          derivedBindings.add(name);
          derivedSources.set(name, new Set(sources));
          const binding = compPath.scope.getBinding(name);
          if (binding) reactiveBindings.set(binding, name);
          ctx.instanceState.get(compName)?.delete(name);
        }
      }
    }
    if (derivations.length > 0) {
      ctx.instanceDerivations.set(compName, derivations);
      ctx.instanceDerivedBindings.set(compName, derivedBindings);
      const exactSources = new Set<string>([
        ...(ctx.instanceState.get(compName) ?? []),
        ...(ctx.componentProps.get(compName)?.bindings ?? []),
      ]);
      const selective = [...exactSources].some((source) =>
        derivations.some(
          (derivation) => !derivation.sources.includes(source),
        ),
      );
      if (selective) {
        const reasonSources = new Set<string>([
          ...exactSources,
          ...derivations.flatMap((derivation) => derivation.sources),
        ]);
        ctx.instanceReasonIds.set(
          compName,
          new Map(
            [...reasonSources]
              .sort()
              .map((source, index) => [source, index]),
          ),
        );
        ctx.selectiveDerivationComponents.add(compName);
      }
    }
  }
}

type ReplayControlPath = NodePath<t.IfStatement | t.SwitchStatement>;

function replayExpressionIsPure(expression: t.Expression): boolean {
  let pure = true;
  t.traverseFast(expression, (node) => {
    if (
      t.isAssignmentExpression(node) ||
      t.isUpdateExpression(node) ||
      t.isAwaitExpression(node) ||
      t.isYieldExpression(node) ||
      t.isNewExpression(node) ||
      t.isTaggedTemplateExpression(node) ||
      t.isFunction(node)
    ) {
      pure = false;
      return;
    }
    if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
      const callee = node.callee;
      pure =
        pure &&
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.object, { name: 'Math' }) &&
        t.isIdentifier(callee.property);
    }
  });
  return pure;
}

function replayAssignmentTarget(
  statement: t.Statement,
): string | null {
  if (
    !t.isExpressionStatement(statement) ||
    !t.isAssignmentExpression(statement.expression, { operator: '=' }) ||
    !t.isIdentifier(statement.expression.left) ||
    !replayExpressionIsPure(statement.expression.right)
  ) {
    return null;
  }
  return statement.expression.left.name;
}

function sameBindings(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size &&
    [...left].every((binding) => right.has(binding))
  );
}

interface ReplayControlShape {
  bindings: Set<string>;
  /** Bindings that are not assigned on at least one control-flow path. */
  partial: Set<string>;
}

/**
 * Return locals assigned by a replay-safe calculation. Partial paths are
 * tracked so emission can restore the declaration initializer before replay.
 */
function replayBindingsForStatement(
  statement: t.Statement,
): ReplayControlShape | null {
  if (t.isExpressionStatement(statement)) {
    const target = replayAssignmentTarget(statement);
    return target === null
      ? null
      : {
          bindings: new Set([target]),
          partial: new Set(),
        };
  }
  if (t.isBlockStatement(statement)) {
    const bindings = new Set<string>();
    const partial = new Set<string>();
    for (const child of statement.body) {
      const childShape = replayBindingsForStatement(child);
      if (childShape === null) return null;
      for (const binding of childShape.bindings) {
        if (bindings.has(binding)) return null;
        bindings.add(binding);
      }
      for (const binding of childShape.partial) partial.add(binding);
    }
    return bindings.size === 0 ? null : { bindings, partial };
  }
  if (t.isIfStatement(statement)) {
    const alternate = statement.alternate;
    if (!replayExpressionIsPure(statement.test)) return null;
    const consequent = replayBindingsForStatement(statement.consequent);
    if (consequent === null) return null;
    if (alternate == null) {
      return {
        bindings: consequent.bindings,
        partial: new Set([
          ...consequent.bindings,
          ...consequent.partial,
        ]),
      };
    }
    const alternateBindings = replayBindingsForStatement(alternate);
    if (
      alternateBindings === null ||
      !sameBindings(consequent.bindings, alternateBindings.bindings)
    ) {
      return null;
    }
    return {
      bindings: consequent.bindings,
      partial: new Set([
        ...consequent.partial,
        ...alternateBindings.partial,
      ]),
    };
  }
  return null;
}

function replayBindingsForSwitch(
  statement: t.SwitchStatement,
): ReplayControlShape | null {
  if (!replayExpressionIsPure(statement.discriminant)) return null;
  let common: ReplayControlShape | null = null;
  for (const item of statement.cases) {
    const test = item.test;
    if (test != null && !replayExpressionIsPure(test)) return null;
    const body = [...item.consequent];
    if (body.at(-1) && t.isBreakStatement(body.at(-1)!)) body.pop();
    if (body.some((child) => t.isBreakStatement(child))) return null;
    const shape = replayBindingsForStatement(t.blockStatement(body));
    if (shape === null) return null;
    if (common === null) {
      common = shape;
    } else {
      if (!sameBindings(common.bindings, shape.bindings)) return null;
      for (const binding of shape.partial) common.partial.add(binding);
    }
  }
  if (
    common !== null &&
    !statement.cases.some((item) => item.test === null)
  ) {
    for (const binding of common.bindings) common.partial.add(binding);
  }
  return common;
}

function violationBelongsTo(
  violation: NodePath,
  statement: t.Statement,
): boolean {
  return (
    violation.node === statement ||
    violation.findParent((parent) => parent.node === statement) !== null
  );
}

/**
 * Classify pure top-level if/switch calculations. The authored statement
 * still initializes its locals once in the factory; emission also clones it
 * into the dependency-selected render prelude. Partial calculations restore
 * their declaration initializers first so an unmatched path cannot retain a
 * value from the previous replay.
 */
function scanInstanceControlFlow(ctx: Ctx): void {
  for (const [compName, compPath] of ctx.compPaths) {
    const reactiveBindings = new Map<unknown, string>();
    for (const name of ctx.componentProps.get(compName)?.bindings ?? []) {
      const binding = compPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(compName) ?? []) {
      const binding = compPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceDerivedBindings.get(compName) ?? []) {
      const binding = compPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = compPath.scope.getBinding(name);
      if (binding?.scope.path.isProgram()) reactiveBindings.set(binding, name);
    }

    const controls: ControlFlowDerivation[] = [];
    const derivedBindings =
      ctx.instanceDerivedBindings.get(compName) ?? new Set<string>();
    for (const statementPath of compPath.get('body').get('body')) {
      if (
        !statementPath.isIfStatement() &&
        !statementPath.isSwitchStatement()
      ) {
        continue;
      }
      const path = statementPath as ReplayControlPath;
      const shape = path.isIfStatement()
        ? replayBindingsForStatement(path.node)
        : replayBindingsForSwitch(path.node);
      if (shape === null) continue;

      let eligible = true;
      const resets: ControlFlowDerivation['resets'] = [];
      const resetPaths: NodePath<t.Expression>[] = [];
      for (const name of shape.bindings) {
        const binding = compPath.scope.getBinding(name);
        const declaration = binding?.path;
        const declarationStatement = declaration?.parentPath;
        if (
          binding === undefined ||
          !declaration?.isVariableDeclarator() ||
          !declarationStatement?.isVariableDeclaration() ||
          (declarationStatement.node.kind !== 'let' &&
            declarationStatement.node.kind !== 'var') ||
          binding.constantViolations.some(
            (violation) => !violationBelongsTo(violation, path.node),
          )
        ) {
          eligible = false;
          break;
        }
        if (shape.partial.has(name)) {
          const initPath = declaration.get('init');
          if (
            !initPath.isExpression() ||
            !replayExpressionIsPure(initPath.node)
          ) {
            eligible = false;
            break;
          }
          resets.push({
            binding: name,
            source: initPath.node,
          });
          resetPaths.push(initPath);
        }
      }
      if (!eligible) continue;

      const reads = new Set<string>();
      const noteIdentifier = (identifierPath: NodePath<t.Identifier>) => {
        const binding = identifierPath.scope.getBinding(
          identifierPath.node.name,
        );
        const source =
          binding === undefined
            ? undefined
            : reactiveBindings.get(binding);
        if (source !== undefined) reads.add(source);
      };
      const visitor = {
        Function(functionPath) {
          functionPath.skip();
        },
        ReferencedIdentifier(identifierPath) {
          if (identifierPath.isIdentifier()) noteIdentifier(identifierPath);
        },
      } satisfies Parameters<NodePath['traverse']>[0];
      path.traverse(visitor);
      for (const resetPath of resetPaths) {
        if (resetPath.isReferencedIdentifier()) {
          noteIdentifier(resetPath);
        }
        resetPath.traverse(visitor);
      }
      if (reads.size === 0) continue;
      for (const name of shape.bindings) {
        if (reads.has(name)) {
          throw path.buildCodeFrameError(
            `memo-dom: reactive control-flow derivation '${name}' reads its own previous value`,
          );
        }
      }

      controls.push({
        statement: path.node,
        bindings: [...shape.bindings].sort(),
        resets,
        sources: [...reads].sort(),
      });
      for (const name of shape.bindings) {
        derivedBindings.add(name);
        const binding = compPath.scope.getBinding(name);
        if (binding) reactiveBindings.set(binding, name);
        ctx.instanceState.get(compName)?.delete(name);
      }
    }
    if (controls.length > 0) {
      ctx.instanceControlFlow.set(compName, controls);
      ctx.instanceDerivedBindings.set(compName, derivedBindings);
    }
  }
}

function finalizeInstancePreludes(ctx: Ctx): void {
  for (const [compName] of ctx.compPaths) {
    const locals = ctx.instanceDerivations.get(compName) ?? [];
    const controls = ctx.instanceControlFlow.get(compName) ?? [];
    if (locals.length === 0 && controls.length === 0) continue;

    const graph = new Map<string, Set<string>>();
    for (const derivation of locals) {
      for (const binding of derivation.bindings) {
        graph.set(binding, new Set(derivation.sources));
      }
    }
    for (const control of controls) {
      for (const binding of control.bindings) {
        graph.set(binding, new Set(control.sources));
      }
    }
    const rootsOf = (
      source: string,
      visiting = new Set<string>(),
    ): Set<string> => {
      const upstream = graph.get(source);
      if (upstream === undefined) return new Set([source]);
      if (visiting.has(source)) return new Set([source]);
      const next = new Set(visiting).add(source);
      const roots = new Set<string>();
      for (const item of upstream) {
        for (const root of rootsOf(item, next)) roots.add(root);
      }
      return roots;
    };
    for (const derivation of locals) {
      derivation.sources = [
        ...new Set(
          derivation.sources.flatMap((source) => [...rootsOf(source)]),
        ),
      ].sort();
    }
    for (const control of controls) {
      control.sources = [
        ...new Set(
          control.sources.flatMap((source) => [...rootsOf(source)]),
        ),
      ].sort();
    }

    const exactSources = new Set<string>([
      ...(ctx.instanceState.get(compName) ?? []),
      ...(ctx.componentProps.get(compName)?.bindings ?? []),
    ]);
    const work = [...locals, ...controls];
    const selective = [...exactSources].some((source) =>
      work.some((derivation) => !derivation.sources.includes(source)),
    );
    ctx.selectiveDerivationComponents.delete(compName);
    ctx.instanceReasonIds.delete(compName);
    if (!selective) continue;
    const reasonSources = new Set<string>([
      ...exactSources,
      ...work.flatMap((derivation) => derivation.sources),
    ]);
    ctx.instanceReasonIds.set(
      compName,
      new Map(
        [...reasonSources]
          .sort()
          .map((source, index) => [source, index]),
      ),
    );
    ctx.selectiveDerivationComponents.add(compName);
  }
}

export function runAnalysis(ctx: Ctx, programPath: NodePath<t.Program>): void {
  validateLinkedImports(ctx, programPath);
  scanModuleState(ctx, programPath);
  scanComponents(ctx, programPath);
  scanInstanceState(ctx);
  scanComputeds(ctx, programPath); // R13: after helpers are known
  scanModuleControlFlow(ctx, programPath, analyzeComputed);
  scanInstanceDerivations(ctx); // R14/R24: ordered local projections/computeds
  scanInstanceControlFlow(ctx);
  finalizeInstancePreludes(ctx);
  scanEffects(ctx);
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

// ---------------------------------------------------------------------
// patterns + access table (Program.exit)
// ---------------------------------------------------------------------

/**
 * All runtime id patterns at which instances of `name` can live.
 * Listed components live at '<site>/Row[k]' for every site (possibly several,
 * with repeated ancestors expanded). Statically-mounted components expand
 * repeated ancestors and multi-parent chains into '[*]' variants.
 */
export function componentPatterns(ctx: Ctx, name: string): string[] {
  const linked = ctx.linkedComponentPaths.get(name);
  if (linked !== undefined) {
    return linked.flatMap((path) => [path, `${path}/*`]);
  }
  const sites = ctx.listedSites.get(name);
  const patterns: string[] = [];
  if (sites && sites.length > 0) {
    if (isLightweightListedComponent(ctx, name)) {
      for (const site of sites) {
        const containerEnd = site.suffix.lastIndexOf('/');
        const container =
          containerEnd < 0
            ? ''
            : `/${site.suffix.slice(0, containerEnd)}`;
        for (const v of pathVariants(ctx, site.owner)) {
          patterns.push(`${v}${container}`, `${v}${container}/*`);
        }
      }
      return patterns;
    }
    // a listed component is never statically mounted — its instances live
    // at '<site>/Row[k]' and nowhere else
    for (const site of sites) {
      for (const v of pathVariants(ctx, site.owner)) {
        patterns.push(`${v}/${site.suffix}/Row[*]`, `${v}/${site.suffix}/Row[*]/*`);
      }
    }
    return patterns;
  }
  for (const v of pathVariants(ctx, name)) patterns.push(v, `${v}/*`);
  return patterns;
}

/**
 * Phase 2 lightweight row eligibility. An entity is only required when the
 * row owns instance state or can mount nested entity/region structure.
 */
export function isLightweightListedComponent(ctx: Ctx, name: string): boolean {
  const imported = ctx.importedComponents.get(name);
  if (imported !== undefined) return imported.listLightweight;

  const cached = ctx.lightweightCache.get(name);
  if (cached !== undefined) return cached;

  let eligible = false;
  const sites = ctx.listedSites.get(name);
  const linkedRows = ctx.linkedComponentRows.get(name);
  if (
    ((sites !== undefined && sites.length > 0) ||
      (linkedRows !== undefined && linkedRows.length > 0)) &&
    ctx.comps.get(name)!.parents.size === 0 &&
    isListLightweightCandidate(ctx, name)
  ) {
    eligible = true;
  }
  ctx.lightweightCache.set(name, eligible);
  return eligible;
}

/** Intrinsic row shape used by the graph linker before a component is listed. */
export function isListLightweightCandidate(ctx: Ctx, name: string): boolean {
  if ((ctx.instanceState.get(name)?.size ?? 0) > 0) return false;
  let eligible = true;
  const path = ctx.compPaths.get(name)!;
  path.traverse({
    JSXElement(el) {
      const tag = el.node.openingElement.name;
      if (t.isJSXIdentifier(tag) && /^[A-Z]/.test(tag.name)) eligible = false;
    },
    CallExpression(call) {
      if (
        (t.isIdentifier(call.node.callee, { name: 'cleanup' }) &&
          call.scope.getBinding('cleanup') === undefined) ||
        (t.isIdentifier(call.node.callee, { name: 'effect' }) &&
          call.scope.getBinding('effect') === undefined)
      ) {
        eligible = false;
      }
      if (matchMapCall(call.node) && containsJsx(call)) eligible = false;
    },
    ConditionalExpression(cond) {
      if (containsJsx(cond)) eligible = false;
    },
    LogicalExpression(logical) {
      if (containsJsx(logical)) eligible = false;
    },
  });
  return eligible;
}

/** The access-table object expression + installAccessTable call, if any. */
export function buildAccessTable(ctx: Ctx): t.Statement | null {
  const add = (variable: string, patterns: readonly string[]): void => {
    const key = canonicalStateKey(ctx, variable);
    let set = ctx.readers.get(key);
    if (!set) ctx.readers.set(key, (set = new Set()));
    for (const p of patterns) set.add(p);
  };

  for (const [comp, vars] of ctx.compReads) {
    if (vars.size === 0) continue;
    const patterns = componentPatterns(ctx, comp);
    for (const v of vars) add(v, patterns);
  }
  for (const { owner, suffix, vars } of ctx.rowReads.values()) {
    const patterns = pathVariants(ctx, owner).flatMap((v) => [
      `${v}/${suffix}/Row[*]`,
      `${v}/${suffix}/Row[*]/*`,
    ]);
    for (const v of vars) add(v, patterns);
  }
  for (const { owner, suffix, vars } of ctx.condReads.values()) {
    const patterns = pathVariants(ctx, owner).flatMap((v) => [
      `${v}/${suffix}`,
      `${v}/${suffix}/*`,
    ]);
    for (const v of vars) add(v, patterns);
  }
  for (const [component, sites] of ctx.effects) {
    const ownerPatterns = componentPatterns(ctx, component)
      .filter((pattern) => !pattern.endsWith('/*'));
    for (const site of sites) {
      const patterns = ownerPatterns.map(
        (pattern) => `${pattern}/$effects/${site.index}`,
      );
      for (const read of site.moduleReads) add(read, patterns);
    }
  }
  // R13: computed entities read their source keys (exact id, no patterns —
  // a computed is a module-level singleton). Depth -1 (emitted by the
  // plugin) makes them recompute BEFORE any reader renders.
  for (const [name, info] of ctx.computeds) {
    const entityId =
      `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#${name}`;
    for (const key of info.reads) add(key, [entityId]);
  }
  for (const flow of ctx.moduleControlFlow) {
    for (const key of flow.sources) add(key, [flow.entityId]);
  }

  if (ctx.readers.size === 0) return null;

  const readerProps = [...ctx.readers.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([v, set]) =>
      t.objectProperty(
        t.stringLiteral(v),
        t.arrayExpression([...set].sort().map((s) => t.stringLiteral(s))),
      ),
    );
  return t.expressionStatement(
    t.callExpression(
      md(ctx, 'installAccessTable'),
      [
        t.objectExpression([
          t.objectProperty(
            t.identifier('readers'),
            t.objectExpression(readerProps),
          ),
        ]),
        t.stringLiteral(ctx.rootId),
      ],
    ),
  );
}
