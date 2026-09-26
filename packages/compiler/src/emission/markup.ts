/**
 * emission/markup.ts - "DOM as data" for static subtrees.
 *
 * Scans a scope's creation stream for contiguous static DOM subtrees and
 * replaces their imperative construction with one compact markup string
 * materialized at runtime:
 *
 *   const _m0 = _MD.materializeMarkup(_HTML_0);
 *   const _text2 = _m0[1];
 *   const _div6 = _m0[9];
 *
 * Hydration parity is structural: materializeMarkup routes to
 * HydrationController.claimMarkup, which claims each markup node through
 * the same sequential creation plan that imperative factory calls use.
 * For that to remain sound a markup segment may only cover a contiguous
 * run of plan nodes — an element absorbs children only when every
 * plan-producing child (element/text nodes) sits inside a leading run of
 * fully-covered children. Structural regions (cond/list/forwarded slots)
 * do not consume plan nodes, so a structural suffix is fine.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import { type Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
import { freshMarkupConst } from '../context/ast';
import type { EmitScope } from './scope';

/**
 * Tags whose parsing or serialization makes static markup unsafe: raw-text
 * elements terminate on '<' in text, <template> keeps its children in a
 * separate .content fragment, and table/select contexts foster-parent or
 * drop children during parsing.
 */
const UNSAFE_TAGS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'listing',
  'template',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'colgroup',
  'select',
  'optgroup',
  'datalist',
  'frameset',
]);

/** Placeholder text node for dynamic text slots (zero-width space). */
const TEXT_PLACEHOLDER = '​';

/**
 * Void elements serialize without a closing tag — `</br>` parses as a
 * second <br> element per the HTML spec. A void element with node children
 * is never covered (children would parse as siblings).
 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const ATTR_NAME_RE = /^[a-zA-Z_][\w:.-]*$/;
const STRUCTURAL_CALLS = new Set(['createCondRegion', 'createListRegion']);

/**
 * Minimum estimated emission savings (bytes) for a scope to adopt markup.
 * The first materializeMarkup call ships the runtime helper (~0.5KB
 * minified), so tiny subtrees stay imperative and pay nothing. Segment
 * savings accumulate per scope so several medium subtrees still qualify.
 */
const MIN_SCOPE_SAVINGS = 550;
const MIN_SEGMENT_SAVINGS = 100;

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';

interface MarkupNode {
  kind: 'element' | 'text' | 'other';
  /** Lowercase local name for elements. */
  tag: string | null;
  /**
   * Imperative namespace: createElement always produces HTML-ns even
   * inside <svg>, while markup parses namespaces by ancestry — a node is
   * covered only when both agree.
   */
  ns: string;
  /** Static text content; null marks a dynamic slot (placeholder node). */
  text: string | null;
  /** Index of the factory statement inside scope.creation. */
  createIndex: number;
  /** innerHTML write or unsafe tag — node is excluded from markup. */
  ineligible: boolean;
}

interface ChildAdd {
  index: number;
  /** node: local factory node; foreign: externally produced node; structural: region/slot mount. */
  kind: 'node' | 'foreign' | 'structural';
  /** Set for kind 'node'/'foreign' appends. */
  child?: string;
}

interface BakedAttr {
  name: string;
  value: string;
  index: number;
  /**
   * class/style helper writes (setClassValue/setStyleValue) normalize and
   * may remove the attribute when empty — empty values stay imperative
   * since markup cannot express "absent". Plain setAttribute('x','') is
   * presence-preserving and bakes as x="".
   */
  helper: boolean;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function identifiersIn(stmt: t.Node, into: Set<string>): void {
  walkAst(stmt as unknown as BaseNode, {
    enter(node) {
      if (node.type === 'Identifier') into.add((node as t.Identifier).name);
    },
  });
}

/** `X.<name>` on identifier X, else null. */
function memberTarget(
  expr: t.Expression | null | undefined,
): { object: string; property: string } | null {
  if (
    expr === null ||
    expr === undefined ||
    !astFactory.isMemberExpression(expr) ||
    expr.computed ||
    !astFactory.isIdentifier(expr.object) ||
    !astFactory.isIdentifier(expr.property)
  ) {
    return null;
  }
  return { object: expr.object.name, property: expr.property.name };
}

/** `_MD.<name>` call name, else null. */
function mdCallee(expr: t.CallExpression): string | null {
  if (
    !astFactory.isMemberExpression(expr.callee) ||
    expr.callee.computed ||
    !astFactory.isIdentifier(expr.callee.object) ||
    !astFactory.isIdentifier(expr.callee.property)
  ) {
    return null;
  }
  return expr.callee.object.name.startsWith('_MD')
    ? expr.callee.property.name
    : null;
}

/**
 * Detect `cond ? null : callback(parent, owner, key)` forwarded-slot mounts
 * — the callback mounts content into `parent`, a structural child-add.
 */
function forwardedSlotTarget(stmt: t.Statement): string | null {
  if (!astFactory.isVariableDeclaration(stmt)) return null;
  for (const declarator of stmt.declarations) {
    const init = declarator.init;
    if (
      init !== null &&
      astFactory.isConditionalExpression(init) &&
      astFactory.isCallExpression(init.alternate) &&
      init.alternate.arguments.length > 0 &&
      astFactory.isIdentifier(init.alternate.arguments[0]) &&
      !astFactory.isMemberExpression(init.alternate.callee)
    ) {
      return init.alternate.arguments[0].name;
    }
  }
  return null;
}

/**
 * Rewrite scope.creation in place: eligible static DOM subtrees become one
 * materializeMarkup call plus indexed member binds. extraStmts are
 * post-creation statements (mounts, disposals) whose node references must
 * keep their targets bound.
 */
export function applyStaticMarkup(
  ctx: Ctx,
  scope: EmitScope,
  rootVar: string | null,
  extraStmts: t.Statement[],
): void {
  if (scope.documentVar === null || scope.creation.length < 2) return;
  const doc = scope.documentVar;

  const nodes = new Map<string, MarkupNode>();
  const childAdds = new Map<string, ChildAdd[]>();
  const attrOps = new Map<string, BakedAttr[]>();
  /**
   * Attr names on a member that also receive non-bakeable writes (dynamic
   * values, removeAttribute, spread props, innerHTML). Baked markup attrs
   * all apply at materialize time, so mixing bakeable and dynamic writes
   * to the same name would reorder them; '*' blocks attr baking entirely.
   */
  const unsafeAttrs = new Map<string, Set<string>>();
  const markUnsafeAttr = (name: string, attr: string): void => {
    const set = unsafeAttrs.get(name) ?? new Set<string>();
    set.add(attr);
    unsafeAttrs.set(name, set);
  };

  const addChild = (parent: string, add: ChildAdd): void => {
    const list = childAdds.get(parent) ?? [];
    list.push(add);
    childAdds.set(parent, list);
  };

  // ---- pass 1: classify ------------------------------------------------
  scope.creation.forEach((stmt, index) => {
    let classified = false;

    // const V = <doc>.<factory>(...)
    if (
      astFactory.isVariableDeclaration(stmt) &&
      stmt.declarations.length === 1
    ) {
      const declarator = stmt.declarations[0]!;
      const init = declarator.init;
      if (
        astFactory.isIdentifier(declarator.id) &&
        init !== null &&
        astFactory.isCallExpression(init) &&
        astFactory.isMemberExpression(init.callee) &&
        !init.callee.computed &&
        astFactory.isIdentifier(init.callee.object, { name: doc }) &&
        astFactory.isIdentifier(init.callee.property)
      ) {
        const varName = declarator.id.name;
        const method = init.callee.property.name;
        const arg0 = init.arguments[0];
        const arg1 = init.arguments[1];
        classified = true;
        if (method === 'createElement' && astFactory.isStringLiteral(arg0)) {
          const tag = arg0.value.toLowerCase();
          nodes.set(varName, {
            kind: 'element',
            tag,
            ns: HTML_NS,
            text: null,
            createIndex: index,
            ineligible: UNSAFE_TAGS.has(tag),
          });
        } else if (
          method === 'createElementNS' &&
          astFactory.isStringLiteral(arg0) &&
          astFactory.isStringLiteral(arg1)
        ) {
          const tag = arg1.value.toLowerCase();
          nodes.set(varName, {
            kind: 'element',
            tag,
            ns: arg0.value,
            text: null,
            createIndex: index,
            ineligible:
              UNSAFE_TAGS.has(tag) ||
              (arg0.value !== SVG_NS && arg0.value !== MATH_NS),
          });
        } else if (method === 'createTextNode') {
          // Dynamic slots emit createTextNode('') + a setTextData seed;
          // markup gets a placeholder node the seed immediately overwrites.
          nodes.set(varName, {
            kind: 'text',
            tag: null,
            ns: HTML_NS,
            text:
              astFactory.isStringLiteral(arg0) && arg0.value !== ''
                ? arg0.value
                : null,
            createIndex: index,
            ineligible: false,
          });
        } else {
          nodes.set(varName, {
            kind: 'other',
            tag: null,
            ns: HTML_NS,
            text: null,
            createIndex: index,
            ineligible: true,
          });
        }
      }
    }
    if (classified) return;

    if (astFactory.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (astFactory.isCallExpression(expr)) {
        const target = memberTarget(expr.callee);
        // P.appendChild(C)
        if (
          target !== null &&
          target.property === 'appendChild' &&
          expr.arguments.length === 1 &&
          astFactory.isIdentifier(expr.arguments[0])
        ) {
          addChild(target.object, {
            index,
            kind: nodes.has(expr.arguments[0].name) ? 'node' : 'foreign',
            child: expr.arguments[0].name,
          });
          return;
        }
        // P.insertBefore / replaceChildren — child-order mutation.
        if (
          target !== null &&
          (target.property === 'insertBefore' ||
            target.property === 'replaceChildren')
        ) {
          addChild(target.object, { index, kind: 'structural' });
          return;
        }
        // V.setAttribute('n', 'v')
        if (
          target !== null &&
          target.property === 'setAttribute' &&
          nodes.has(target.object) &&
          expr.arguments.length === 2 &&
          astFactory.isStringLiteral(expr.arguments[0]) &&
          astFactory.isStringLiteral(expr.arguments[1])
        ) {
          const list = attrOps.get(target.object) ?? [];
          list.push({
            name: expr.arguments[0].value,
            value: expr.arguments[1].value,
            index,
            helper: false,
          });
          attrOps.set(target.object, list);
          return;
        }
        // _MD.setClassValue(V, 'x') / _MD.setStyleValue(V, 'x')
        const mdName = mdCallee(expr);
        if (
          (mdName === 'setClassValue' || mdName === 'setStyleValue') &&
          expr.arguments.length === 2 &&
          astFactory.isIdentifier(expr.arguments[0]) &&
          nodes.has(expr.arguments[0].name) &&
          astFactory.isStringLiteral(expr.arguments[1])
        ) {
          const list = attrOps.get(expr.arguments[0].name) ?? [];
          list.push({
            name: mdName === 'setClassValue' ? 'class' : 'style',
            value: expr.arguments[1].value,
            index,
            helper: true,
          });
          attrOps.set(expr.arguments[0].name, list);
          return;
        }
        // _MD.createCondRegion(P, ...) / _MD.createListRegion(P, ...)
        if (
          mdName !== null &&
          STRUCTURAL_CALLS.has(mdName) &&
          astFactory.isIdentifier(expr.arguments[0])
        ) {
          addChild(expr.arguments[0].name, { index, kind: 'structural' });
          return;
        }
      }
      // V.innerHTML = ... — element excluded from markup coverage.
      if (
        astFactory.isAssignmentExpression(expr) &&
        astFactory.isMemberExpression(expr.left) &&
        !expr.left.computed &&
        astFactory.isIdentifier(expr.left.object) &&
        astFactory.isIdentifier(expr.left.property, { name: 'innerHTML' })
      ) {
        const node = nodes.get(expr.left.object.name);
        if (node !== undefined) node.ineligible = true;
      }
    }

    // Forwarded slot mounts push content into a parent — structural add.
    const forwarded = forwardedSlotTarget(stmt);
    if (forwarded !== null) {
      addChild(forwarded, { index, kind: 'structural' });
    }

    // Non-bakeable attribute writes can nest inside slotGuard `if`s — walk
    // the whole statement. A baked attr whose name also receives a dynamic
    // write would reorder writes (markup applies all baked attrs at
    // materialize time), so such names stay imperative.
    walkAst(stmt as unknown as BaseNode, {
      enter(node) {
        if (astFactory.isCallExpression(node as BaseNode)) {
          const call = node as unknown as t.CallExpression;
          const mdName = mdCallee(call);
          const arg0 = call.arguments[0];
          const arg1 = call.arguments[1];
          const member =
            mdName === null ? memberTarget(call.callee) : null;
          const targetName = astFactory.isIdentifier(arg0)
            ? arg0.name
            : member !== null
              ? member.object
              : null;
          if (
            targetName === null ||
            !nodes.has(targetName)
          ) {
            return;
          }
          const nameArg =
            astFactory.isStringLiteral(arg1) && mdName !== null
              ? arg1.value
              : null;
          switch (mdName) {
            case 'domAttributeWrite':
              markUnsafeAttr(targetName, nameArg ?? '*');
              return;
            case 'domPropertyWrite':
            case 'setDomValue':
              if (nameArg === 'innerHTML') {
                nodes.get(targetName)!.ineligible = true;
              }
              return;
            case 'setClassValue':
              if (!astFactory.isStringLiteral(arg1)) {
                markUnsafeAttr(targetName, 'class');
              }
              return;
            case 'setStyleValue':
              if (!astFactory.isStringLiteral(arg1)) {
                markUnsafeAttr(targetName, 'style');
              }
              return;
            case 'patchDomProps':
            case 'setProps':
              markUnsafeAttr(targetName, '*');
              return;
            case null:
              if (
                member !== null &&
                member.object === targetName &&
                (member.property === 'setAttribute' ||
                  member.property === 'removeAttribute')
              ) {
                // Literal-literal setAttribute is the bakeable shape — it
                // is only unsafe when the value is not a static string.
                if (
                  member.property === 'removeAttribute' ||
                  !astFactory.isStringLiteral(call.arguments[1])
                ) {
                  markUnsafeAttr(
                    targetName,
                    astFactory.isStringLiteral(call.arguments[0])
                      ? call.arguments[0].value
                      : '*',
                  );
                }
              }
              return;
            default:
              return;
          }
        }
        if (astFactory.isAssignmentExpression(node as BaseNode)) {
          const assign = node as unknown as t.AssignmentExpression;
          if (
            astFactory.isMemberExpression(assign.left) &&
            !assign.left.computed &&
            astFactory.isIdentifier(assign.left.object) &&
            nodes.has(assign.left.object.name) &&
            astFactory.isIdentifier(assign.left.property) &&
            (assign.left.property.name === 'innerHTML' ||
              assign.left.property.name === 'outerHTML')
          ) {
            nodes.get(assign.left.object.name)!.ineligible = true;
          }
        }
      },
    });
  });

  if (nodes.size === 0) return;

  // ---- pass 2: coverage -----------------------------------------------
  // coveredChildren(E) is set when every plan-producing child of E sits in
  // a leading run of fully-covered node children (structural adds after
  // the run are allowed — they append their own markers).
  const coveredChildren = new Map<string, string[]>();
  const coveredMemo = new Map<string, boolean>();

  const fullyCovered = (name: string): boolean => {
    const memo = coveredMemo.get(name);
    if (memo !== undefined) return memo;
    const node = nodes.get(name)!;
    let ok = node.kind === 'text' && !node.ineligible;
    if (node.kind === 'element' && !node.ineligible) {
      const adds = childAdds.get(name) ?? [];
      const members: string[] = [];
      let i = 0;
      // Void elements cannot carry children in markup — absorbed children
      // would parse as siblings rather than descendants.
      const voidBlocked =
        VOID_TAGS.has(node.tag!) && adds.some((add) => add.kind === 'node');
      for (; !voidBlocked && i < adds.length; i++) {
        const add = adds[i]!;
        if (add.kind !== 'node' || !fullyCovered(add.child!)) break;
        members.push(add.child!);
      }
      // Two adjacent text children merge into one DOM node in markup —
      // the claim sequence must match the plan exactly, so refuse.
      const adjacentText = members.some(
        (member, j) =>
          j + 1 < members.length &&
          nodes.get(member)!.kind === 'text' &&
          nodes.get(members[j + 1]!)!.kind === 'text',
      );
      ok =
        !voidBlocked &&
        !adjacentText &&
        adds.slice(i).every((add) => add.kind === 'structural');
      if (ok) coveredChildren.set(name, members);
    }
    coveredMemo.set(name, ok);
    return ok;
  };

  // ---- pass 3: candidate segments --------------------------------------
  // process outermost first (parents have the highest createIndex).
  interface Candidate {
    markup: string;
    members: string[]; // claim/bind order — post-order == createIndex order
    absorbed: Set<number>;
    saved: number;
  }
  const candidates: Candidate[] = [];
  const inSegment = new Set<string>();

  // Bakeable attrs: valid names, last write wins per name (imperative
  // setAttribute semantics), helper writes only when non-empty, and no
  // non-bakeable write to the same name — markup applies all baked attrs
  // at materialize time, so a same-name dynamic write would reorder.
  const bakedAttrs = (name: string): BakedAttr[] => {
    const unsafe = unsafeAttrs.get(name);
    if (unsafe !== undefined && unsafe.has('*')) return [];
    const list = (attrOps.get(name) ?? []).filter(
      (attr) =>
        ATTR_NAME_RE.test(attr.name) &&
        !(attr.helper && attr.value === '') &&
        !(unsafe !== undefined && unsafe.has(attr.name)),
    );
    const last = new Map<string, number>();
    list.forEach((attr, i) => last.set(attr.name, i));
    return list.filter((attr, i) => last.get(attr.name) === i);
  };

  /**
   * Serialize a covered subtree; null when the parser's namespace
   * derivation would disagree with the node's imperative namespace
   * (createElement always makes HTML-ns nodes, even inside <svg>, while
   * markup inherits namespaces by ancestry).
   */
  const emitMarkup = (name: string, parentNs: string): string | null => {
    const node = nodes.get(name)!;
    if (node.kind === 'text') {
      return node.text === null ? TEXT_PLACEHOLDER : escapeText(node.text);
    }
    const derivedNs =
      node.tag === 'svg'
        ? SVG_NS
        : node.tag === 'math'
          ? MATH_NS
          : node.tag === 'foreignobject'
            ? HTML_NS
            : parentNs;
    if (node.ns !== derivedNs) return null;
    let markup = `<${node.tag}`;
    for (const attr of bakedAttrs(name)) {
      const value = attr.name === 'class' ? attr.value.trim() : attr.value;
      markup += ` ${attr.name}="${escapeAttr(value)}"`;
    }
    markup += '>';
    // Void elements serialize bare — a closing tag would create siblings.
    if (VOID_TAGS.has(node.tag!)) return markup;
    for (const child of coveredChildren.get(name) ?? []) {
      const childMarkup = emitMarkup(child, derivedNs);
      if (childMarkup === null) return null;
      markup += childMarkup;
    }
    return markup + `</${node.tag}>`;
  };

  const postOrder = (name: string, out: string[]): void => {
    for (const child of coveredChildren.get(name) ?? []) postOrder(child, out);
    out.push(name);
  };

  const ordered = [...nodes.entries()].sort(
    (a, b) => b[1].createIndex - a[1].createIndex,
  );
  for (const [name, node] of ordered) {
    if (node.kind !== 'element' || node.ineligible || inSegment.has(name)) {
      continue;
    }
    const members: string[] = [];
    if (fullyCovered(name)) {
      postOrder(name, members);
    } else {
      members.push(name);
    }

    // Hydration contiguity: claimMarkup consumes a contiguous run of plan
    // nodes in creation order — every factory node between the first and
    // last member must be a member, and the markup's post-order must equal
    // the plan's claim sequence (ascending createIndex).
    const memberSet = new Set(members);
    let low = Number.MAX_SAFE_INTEGER;
    let high = -1;
    for (const member of members) {
      const index = nodes.get(member)!.createIndex;
      if (index < low) low = index;
      if (index > high) high = index;
    }
    const contiguous = [...nodes.entries()].every(
      ([otherName, other]) =>
        other.createIndex < low ||
        other.createIndex > high ||
        memberSet.has(otherName),
    );
    const strictlyIncreasing = members.every(
      (member, i) =>
        i === 0 ||
        nodes.get(member)!.createIndex >
          nodes.get(members[i - 1]!)!.createIndex,
    );
    if (!contiguous || !strictlyIncreasing) continue;

    // Markup roots parse in HTML context (the materialize call has no
    // parent); a root whose imperative namespace disagrees cannot emit.
    const markup = emitMarkup(name, HTML_NS);
    if (markup === null) continue;
    const bakedTotal = members.reduce(
      (sum, member) => sum + bakedAttrs(member).length,
      0,
    );
    // Imperative ~48B/node + 26B/append + 34B/attr vs markup string
    // (hoisted const ~15B overhead) + materialize call ~42B + binds ~17B.
    const saved =
      members.length * 48 +
      (members.length - 1) * 26 +
      bakedTotal * 34 -
      (markup.length + 57 + members.length * 17);
    if (saved <= 0) continue;

    const absorbed = new Set<number>();
    for (const member of members) {
      absorbed.add(nodes.get(member)!.createIndex);
      for (const attr of bakedAttrs(member)) absorbed.add(attr.index);
    }
    candidates.push({ markup, members, absorbed, saved });
    for (const member of members) inSegment.add(member);
  }

  const memberOf = new Map<string, Candidate>();
  for (const candidate of candidates) {
    for (const member of candidate.members) memberOf.set(member, candidate);
  }

  // ---- pass 4: absorb intra-segment appends, apply savings floor -------
  scope.creation.forEach((stmt, index) => {
    if (!astFactory.isExpressionStatement(stmt)) return;
    const expr = stmt.expression;
    if (!astFactory.isCallExpression(expr)) return;
    const target = memberTarget(expr.callee);
    if (
      target !== null &&
      target.property === 'appendChild' &&
      expr.arguments.length === 1 &&
      astFactory.isIdentifier(expr.arguments[0])
    ) {
      const childSegment = memberOf.get(expr.arguments[0].name);
      if (
        childSegment !== undefined &&
        childSegment === memberOf.get(target.object)
      ) {
        childSegment.absorbed.add(index);
      }
    }
  });

  // The runtime helper ships when any segment emits — a scope only adopts
  // markup when its combined savings clearly exceed that fixed cost.
  const viable = candidates.filter(
    (candidate) => candidate.saved > MIN_SEGMENT_SAVINGS,
  );
  const total = viable.reduce((sum, candidate) => sum + candidate.saved, 0);
  if (total < MIN_SCOPE_SAVINGS) return;

  const absorbed = new Set<number>();
  for (const candidate of viable) {
    for (const index of candidate.absorbed) absorbed.add(index);
  }

  const bound = new Set<string>();
  const collectUses = (stmt: t.Statement): void => {
    const ids = new Set<string>();
    identifiersIn(stmt, ids);
    for (const id of ids) if (memberOf.has(id)) bound.add(id);
  };
  scope.creation.forEach((stmt, index) => {
    if (!absorbed.has(index)) collectUses(stmt);
  });
  for (const stmt of [...scope.mounts, ...extraStmts]) collectUses(stmt);
  if (rootVar !== null && memberOf.has(rootVar)) bound.add(rootVar);

  // ---- pass 5: rewrite --------------------------------------------------
  const inserts = new Map<number, t.Statement[]>();
  for (const candidate of viable) {
    const html = freshMarkupConst(ctx, candidate.markup);
    const segVar = generatedIdentifier(ctx, 'markup');
    const stmts: t.Statement[] = [
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(segVar.name),
          astFactory.callExpression(md(ctx, 'materializeMarkup'), [html]),
        ),
      ]),
    ];
    candidate.members.forEach((member, memberIndex) => {
      if (!bound.has(member)) return;
      stmts.push(
        astFactory.variableDeclaration('const', [
          astFactory.variableDeclarator(
            astFactory.identifier(member),
            astFactory.memberExpression(
              astFactory.identifier(segVar.name),
              astFactory.numericLiteral(memberIndex),
              true,
            ),
          ),
        ]),
      );
    });
    let earliest = Number.MAX_SAFE_INTEGER;
    for (const index of candidate.absorbed) {
      if (index < earliest) earliest = index;
    }
    inserts.set(earliest, stmts);
  }

  const rewritten: t.Statement[] = [];
  scope.creation.forEach((stmt, index) => {
    const pending = inserts.get(index);
    if (pending !== undefined) rewritten.push(...pending);
    if (!absorbed.has(index)) rewritten.push(stmt);
  });
  scope.creation = rewritten;

  // When markup absorbed every factory call the hoisted document local is
  // dead — drop it unless surviving code still references it. extraStmts
  // include the materialized updater fn, so late binds are covered.
  if (scope.documentVar !== null) {
    const docName = scope.documentVar;
    let used = false;
    const scan = (stmt: t.Statement): void => {
      walkAst(stmt as unknown as BaseNode, {
        enter(node) {
          if (
            node.type === 'Identifier' &&
            (node as t.Identifier).name === docName
          ) {
            used = true;
          }
        },
      });
    };
    for (const stmt of [
      ...scope.creation,
      ...scope.mounts,
      ...extraStmts,
    ]) {
      if (used) break;
      scan(stmt);
    }
    if (!used) {
      scope.prelude = scope.prelude.filter(
        (decl) =>
          !(
            astFactory.isVariableDeclaration(decl) &&
            decl.declarations.some(
              (d) =>
                astFactory.isIdentifier(d.id) &&
                (d.id as t.Identifier).name === docName,
            )
          ),
      );
      scope.documentVar = null;
    }
  }
}
