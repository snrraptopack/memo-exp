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
 * componentPatterns (incl. listed-row sites), summarizeHelper (module-local
 * function summaries), and buildAccessTable (Program.exit).
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
  exprReadsState,
  isConstCollection,
  isStoreObject,
  memberKey,
  memberRootName,
  MUTATOR_METHODS,
  walkNodes,
  type Ctx,
  type ComputedAnalysis,
  type FnSummary,
} from './context';
import { analyzeMapSite, containsJsx, matchMapCall } from './lists';
import { analyzeCondSite } from './conds';

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
  if (!parent?.isJSXExpressionContainer() || !grand?.isJSXElement()) {
    throw c.buildCodeFrameError(
      'memo-dom: conditional rendering must be a direct JSX child: <div>{cond ? <A/> : <B/>}</div>',
    );
  }
  c.skip();
}

// ---------------------------------------------------------------------
// pass 1
// ---------------------------------------------------------------------

function scanModuleState(ctx: Ctx, programPath: NodePath<t.Program>): void {
  for (const stmt of programPath.node.body) {
    // M5.5: exported state is still state — unwrap the export wrapper
    const inner = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    if (!t.isVariableDeclaration(inner)) continue;
    for (const decl of inner.declarations) {
      if (!t.isIdentifier(decl.id)) continue;
      if (inner.kind === 'let' || inner.kind === 'var') {
        ctx.state.set(decl.id.name, 'let');
      } else if (inner.kind === 'const') {
        if (isStoreObject(decl.init)) {
          ctx.state.set(decl.id.name, 'store');
        } else if (isConstCollection(decl.init)) {
          ctx.state.set(decl.id.name, 'const');
        }
      }
    }
  }
}

/**
 * Top-level `function` declarations split by content: with JSX → component
 * (transformed), without → helper (left alone, summarized). M5.3: previously
 * every top-level function was treated as a component, so helpers were
 * impossible and the error message blamed the wrong rule.
 */
function scanComponents(ctx: Ctx, programPath: NodePath<t.Program>): void {
  programPath.traverse({
    FunctionDeclaration(p) {
      const name = p.node.id?.name;
      if (name && !ctx.comps.has(name) && !ctx.helpers.has(name)) {
        if (containsJsx(p)) {
          ctx.comps.set(name, { parents: new Set(), jsxCount: 0 });
          ctx.compPaths.set(name, p);
          const first = p.node.params[0];
          if (
            p.node.params.length === 1 &&
            t.isIdentifier(first) &&
            first.name === 'props' &&
            t.isTSTypeLiteral(first.typeAnnotation?.typeAnnotation)
          ) {
            ctx.objectPropComponents.add(name);
          }
        } else {
          ctx.helpers.set(name, p);
        }
      }
      p.skip(); // nested functions are never top-level components/helpers
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
  if (visiting.has(name)) {
    throw ctx.compPaths.get(name)!.buildCodeFrameError(
      `memo-dom: recursive component '${name}' — components cannot render themselves (L1)`,
    );
  }
  const info = ctx.comps.get(name)!;
  if (info.parents.size === 0) return [ctx.rootId];
  visiting.add(name);
  const out: string[] = [];
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
        if (!ctx.comps.has(tag)) {
          throw el.buildCodeFrameError(
            `memo-dom: <${tag} /> is not a known component — L1 components must be top-level function declarations in the same module`,
          );
        }
        if (el.node.children.some((c) => !t.isJSXText(c) || c.value.trim() !== '')) {
          throw el.buildCodeFrameError(
            'memo-dom: children props are not supported yet (L1)',
          );
        }
        // R10: state-reading props are allowed — prop reads are collected
        // by collectReads' generic Identifier/MemberExpression visitors (no
        // component skip there), so the parent updates exactly when a pushed
        // value can change. (Was the mount-time ban, now lifted.)
        ctx.comps.get(tag)!.parents.add(name);
        let counts = ctx.childRefCounts.get(name);
        if (!counts) ctx.childRefCounts.set(name, (counts = new Map()));
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        el.skip(); // the child owns its own subtree
        return;
      }
      info.jsxCount++;
    },
    JSXFragment(f) {
      throw f.buildCodeFrameError(
        'memo-dom: fragments are not supported yet (L1)',
      );
    },
    JSXSpreadAttribute(s) {
      throw s.buildCodeFrameError(
        'memo-dom: spread attributes are not supported (L1)',
      );
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
          !grand?.isJSXElement()
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

/** Is this member expression the callee of a mutator call (store.items.push)? */
function isMutatorCallee(m: NodePath<t.MemberExpression>): boolean {
  const parent = m.parentPath;
  if (!parent.isCallExpression() || parent.node.callee !== m.node) return false;
  const prop = m.node.property;
  const pn =
    !m.node.computed && t.isIdentifier(prop)
      ? prop.name
      : m.node.computed && t.isStringLiteral(prop)
        ? prop.value
        : null;
  return pn !== null && MUTATOR_METHODS.has(pn);
}

/**
 * The dotted read key of a store member expression ('store.items.length'),
 * or null when it is not a read (write target, mutator callee, non-store).
 */
function storeReadKey(ctx: Ctx, m: NodePath<t.MemberExpression>): string | null {
  const key = memberKey(m.node);
  if (!key || !key.includes('.')) return null;
  const rootName = key.split('.')[0]!;
  if (ctx.state.get(rootName) !== 'store') return null;
  const parent = m.parentPath;
  if (
    parent.isAssignmentExpression({ operator: '=' }) &&
    parent.node.left === m.node
  ) {
    return null; // write target, not a read
  }
  if (isMutatorCallee(m)) return null; // the object chain registers itself
  return key;
}

// ---------------------------------------------------------------------
// helper summaries (module-local function summaries, §4.6 shape 2 subset)
// ---------------------------------------------------------------------

/**
 * Read/write summary of a module-level helper, memoized and cycle-safe.
 * A recursive helper's summary is marked opaque — callers fall back to a
 * root-subtree commit (never incorrect, only unscoped).
 */
export function summarizeHelper(
  ctx: Ctx,
  name: string,
  visiting: Set<string> = new Set(),
): FnSummary {
  const cached = ctx.helperSummaries.get(name);
  if (cached) return cached;
  if (visiting.has(name)) {
    return { reads: new Set(), writes: new Set(), opaque: true };
  }
  const p = ctx.helpers.get(name)!;
  const locals = new Set<string>();
  const sum: FnSummary = { reads: new Set(), writes: new Set(), opaque: false };

  visiting.add(name);

  // locals declared anywhere in the helper (params, declarators, nested params)
  p.traverse({
    VariableDeclarator(d) {
      if (t.isIdentifier(d.node.id)) locals.add(d.node.id.name);
    },
    Function(f) {
      for (const param of f.node.params) {
        if (t.isIdentifier(param)) locals.add(param.name);
      }
    },
  });

  const noteMemberWrite = (node: t.MemberExpression): void => {
    const rootName = memberRootName(node);
    if (!rootName || !ctx.state.has(rootName)) return;
    if (ctx.state.get(rootName) !== 'store') {
      sum.writes.add(rootName); // member write on a root-keyed var (let/const)
      return;
    }
    const key = memberKey(node);
    if (key !== null && key.includes('.')) {
      sum.writes.add(key);
    } else {
      ctx.opaqueVars.add(rootName);
      sum.opaque = true;
    }
  };

  p.traverse({
    AssignmentExpression(ap) {
      const left = ap.node.left;
      if (t.isIdentifier(left)) {
        if (!locals.has(left.name) && ctx.state.has(left.name)) sum.writes.add(left.name);
      } else if (t.isMemberExpression(left)) {
        noteMemberWrite(left);
      }
    },
    UpdateExpression(up) {
      const arg = up.node.argument;
      if (t.isIdentifier(arg)) {
        if (!locals.has(arg.name) && ctx.state.has(arg.name)) sum.writes.add(arg.name);
      } else if (t.isMemberExpression(arg)) {
        noteMemberWrite(arg);
      }
    },
    CallExpression(cp) {
      const callee = cp.node.callee;
      if (t.isMemberExpression(callee)) {
        const prop = callee.property;
        const pn =
          !callee.computed && t.isIdentifier(prop)
            ? prop.name
            : callee.computed && t.isStringLiteral(prop)
              ? prop.value
              : null;
        if (pn !== null && MUTATOR_METHODS.has(pn)) {
          const obj = callee.object;
          const rootName = t.isIdentifier(obj)
            ? obj.name
            : t.isMemberExpression(obj)
              ? memberRootName(obj)
              : null;
          if (rootName && ctx.state.has(rootName)) {
            if (ctx.state.get(rootName) !== 'store') {
              sum.writes.add(rootName); // mutating a let/const collection in place
            } else {
              const key = t.isMemberExpression(obj) ? memberKey(obj) : null;
              if (key !== null) {
                sum.writes.add(key);
              } else {
                ctx.opaqueVars.add(rootName);
                sum.opaque = true;
              }
            }
          }
        }
      } else if (t.isIdentifier(callee) && ctx.helpers.has(callee.name)) {
        const sub = summarizeHelper(ctx, callee.name, visiting);
        for (const r of sub.reads) sum.reads.add(r);
        for (const w of sub.writes) sum.writes.add(w);
        if (sub.opaque) sum.opaque = true;
      }
    },
    Identifier(id) {
      const n = id.node.name;
      if (!ctx.state.has(n) || locals.has(n)) return;
      const parent = id.parentPath;
      if (
        parent.isAssignmentExpression({ operator: '=' }) &&
        parent.node.left === id.node
      ) {
        return; // write target, not a read
      }
      sum.reads.add(n);
    },
    MemberExpression(m) {
      const key = storeReadKey(ctx, m);
      if (key !== null) sum.reads.add(key);
    },
  });

  visiting.delete(name);
  ctx.helperSummaries.set(name, sum);
  return sum;
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
     * R8: a JSX-bearing conditional is a REGION — every state var read in
     * the condition OR either branch is attributed to the region's patterns
     * ('<owner>/when<n>'), so writes dirty the region, not the owner.
     */
    function handleCond(
      c: NodePath<t.ConditionalExpression> | NodePath<t.LogicalExpression>,
    ): void {
      const node = c.node;
      if (!containsJsx(c)) return; // attribute ternaries etc.: plain reads
      const site = analyzeCondSite(node, c, usedConds);
      const vars = collectStateIds(ctx, node);
      if (vars.size > 0) {
        ctx.condReads.set(`${name}/${site.suffix}`, {
          owner: name,
          suffix: site.suffix,
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
        const mapCall = matchMapCall(call.node);
        if (mapCall && containsJsx(call)) {
          const site = analyzeMapSite(ctx, mapCall, call, name, usedPrefixes);
          reads.add(site.arrayName); // the owner reads the array
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
                if (t.isIdentifier(n) && ctx.state.has(n.name)) reads.add(n.name);
                if (t.isMemberExpression(n)) {
                  const key = memberKey(n);
                  if (key !== null && key.includes('.')) {
                    const rootName = key.split('.')[0]!;
                    if (ctx.state.get(rootName) === 'store') reads.add(key);
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
                arrayName: site.arrayName,
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
                if (id.node.name !== site.itemParam && ctx.state.has(id.node.name)) {
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
        if (t.isIdentifier(callee) && ctx.helpers.has(callee.name)) {
          for (const r of summarizeHelper(ctx, callee.name).reads) reads.add(r);
        }
      },

      Identifier(id) {
        if (!ctx.state.has(id.node.name)) return;
        if (ctx.instanceState.get(name)?.has(id.node.name) === true) {
          return; // R12: instance state SHADOWS module state in its component
        }
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
 * The blacklist covers only what would corrupt the state model itself:
 *   - assignments / updates to non-locals (writes belong in handlers)
 *   - mutator calls on state (mutating a source inside its own derivation)
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
  walkNodes(expr, (n) => {
    if (t.isFunction(n)) {
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
      if (t.isMemberExpression(c)) {
        const pn =
          !c.computed && t.isIdentifier(c.property)
            ? c.property.name
            : c.computed && t.isStringLiteral(c.property)
              ? c.property.value
              : null;
        if (pn !== null && MUTATOR_METHODS.has(pn)) {
          const root = t.isIdentifier(c.object)
            ? c.object.name
            : t.isMemberExpression(c.object)
              ? memberRootName(c.object)
              : null;
          // mutating LOCALS is fine (reduce accumulators); mutating the
          // derivation's own source is not
          if (root !== null && !locals.has(root) && ctx.state.has(root)) {
            fail(
              `calls '${pn}' on state '${root}' — mutating a source inside its own derivation; derive from a copy instead`,
            );
          }
        }
        // every other member call is fine — any object, any method
      } else if (t.isIdentifier(c) && ctx.helpers.has(c.name)) {
        const sum = summarizeHelper(ctx, c.name);
        for (const r of sum.reads) reads.add(r);
        if (sum.writes.size > 0) {
          for (const w of sum.writes) reads.add(w); // ensure the error triggers
          fail(`calls helper '${c.name}' which writes state — writes belong in handlers`);
        } else if (sum.opaque) {
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
      if (ctx.state.has(name)) continue; // store / const-collection already
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
      ctx.state.set(name, 'computed');
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
      if (stmt.kind !== 'let' && stmt.kind !== 'var') continue;
      for (const d of stmt.declarations) {
        if (t.isIdentifier(d.id)) vars.add(d.id.name);
      }
    }
    if (vars.size > 0) ctx.instanceState.set(name, vars);
  }
}

export function runAnalysis(ctx: Ctx, programPath: NodePath<t.Program>): void {
  scanModuleState(ctx, programPath);
  scanComponents(ctx, programPath);
  scanInstanceState(ctx);
  scanComputeds(ctx, programPath); // R13: after helpers are known
  for (const [name] of ctx.comps) analyzeComponent(ctx, name);
  // acyclicity check runs unconditionally — a state-free recursive component
  // would otherwise slip past (pathVariants is only reached via the table)
  for (const [name] of ctx.comps) pathVariants(ctx, name);
  collectReads(ctx);

  for (const [comp, sites] of ctx.listedSites) {
    const p = ctx.compPaths.get(comp)!;
    // a listed component renders at '<site>/Row[k]', so its own static path
    // never matches runtime ids — a list INSIDE one would misroute
    const bad: NodePath[] = [];
    p.traverse({
      CallExpression(c) {
        if (bad.length === 0 && matchMapCall(c.node) && containsJsx(c)) bad.push(c);
      },
    });
    if (bad.length > 0) {
      throw bad[0]!.buildCodeFrameError(
        'memo-dom: lists inside list-row components are not supported yet (R7 L1)',
      );
    }
    // used both as a row AND a static child: patterns would drop one usage
    if (sites.length > 0 && ctx.comps.get(comp)!.parents.size > 0) {
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
  const sites = ctx.listedSites.get(name);
  const patterns: string[] = [];
  if (sites && sites.length > 0) {
    if (isLightweightListedComponent(ctx, name)) {
      for (const site of sites) {
        for (const v of pathVariants(ctx, site.owner)) patterns.push(v, `${v}/*`);
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
  const sites = ctx.listedSites.get(name);
  if (!sites || sites.length === 0 || ctx.comps.get(name)!.parents.size > 0) return false;
  if ((ctx.instanceState.get(name)?.size ?? 0) > 0) return false;

  let eligible = true;
  const path = ctx.compPaths.get(name)!;
  path.traverse({
    JSXElement(el) {
      const tag = el.node.openingElement.name;
      if (t.isJSXIdentifier(tag) && /^[A-Z]/.test(tag.name)) eligible = false;
    },
    CallExpression(call) {
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
    let set = ctx.readers.get(variable);
    if (!set) ctx.readers.set(variable, (set = new Set()));
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
  // R13: computed entities read their source keys (exact id, no patterns —
  // a computed is a module-level singleton). Depth -1 (emitted by the
  // plugin) makes them recompute BEFORE any reader renders.
  for (const [name, info] of ctx.computeds) {
    for (const key of info.reads) add(key, [`${ctx.rootId}/$computed/${name}`]);
  }

  if (ctx.readers.size === 0 && ctx.opaqueVars.size === 0) return null;

  const readerProps = [...ctx.readers.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([v, set]) =>
      t.objectProperty(
        t.stringLiteral(v),
        t.arrayExpression([...set].sort().map((s) => t.stringLiteral(s))),
      ),
    );
  const tableProps: t.ObjectProperty[] = [
    t.objectProperty(t.identifier('readers'), t.objectExpression(readerProps)),
  ];
  if (ctx.opaqueVars.size > 0) {
    tableProps.push(
      t.objectProperty(
        t.identifier('opaque'),
        t.arrayExpression([...ctx.opaqueVars].sort().map((s) => t.stringLiteral(s))),
      ),
    );
  }
  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(t.identifier('MD'), t.identifier('installAccessTable')),
      [t.objectExpression(tableProps), t.stringLiteral(ctx.rootId)],
    ),
  );
}
