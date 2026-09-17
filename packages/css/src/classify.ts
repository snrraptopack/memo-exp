/**
 * classify: StyleObject → StyleProgram.
 *
 * Dispatches every key by position — property → declaration, pseudo →
 * selector context, selector string → descendant/compound context, at-rule
 * name → at-rule prelude — and every value into a ValueExpr. Then two lift
 * passes normalize the tree into flat blocks:
 *
 *   liftMaps   — `{base, '>=40rem'}` decls split into base + media blocks
 *   liftConds  — cond-valued decls split into variant-class blocks
 *
 * Both run to fixpoint, so maps inside conds and conds inside maps work.
 */

import type {
  Block,
  Decl,
  MapSlot,
  Prelude,
  StyleProgram,
  ValueExpr,
  VariantClass,
} from './grammar';
import { isMarker } from './grammar';
import type { StyleObject, VarRef } from './types';

const PSEUDO_ELEMENTS = new Set([
  'before', 'after', 'placeholder', 'marker', 'selection', 'backdrop',
  'firstLine', 'firstLetter', 'fileSelectorButton', 'grammarError',
  'spellingError', 'targetText', 'highlight',
]);

const PSEUDO_CLASSES = new Set([
  'hover', 'active', 'focus', 'focusVisible', 'focusWithin', 'visited',
  'link', 'target', 'disabled', 'enabled', 'checked', 'indeterminate',
  'required', 'optional', 'readOnly', 'readWrite', 'empty', 'root',
  'firstChild', 'lastChild', 'onlyChild', 'firstOfType', 'lastOfType',
  'onlyOfType', 'placeholderShown', 'autofill', 'anyLink', 'fullscreen',
  'modal', 'popoverOpen', 'userInvalid', 'userValid', 'inert', 'paused',
  'playing',
]);

const PARAMETERIZED_PSEUDO =
  /^(nth-child|nth-last-child|nth-of-type|nth-last-of-type|not|is|where|has|dir|lang|host|state)\(.+\)$/;

const AT_RULE_KEYS = new Set(['media', 'supports', 'container', 'layer', 'scope']);

const SELECTOR_START = /^[.#>+~*[\]&]/;

const RANGE_GE = /^>=(.+)$/;
const RANGE_LT = /^<(.+)$/;
const RANGE_BETWEEN = /^(.+?)\.\.(.+)$/;

export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function isPseudo(key: string): boolean {
  return (
    PSEUDO_CLASSES.has(key) ||
    PSEUDO_ELEMENTS.has(key) ||
    PARAMETERIZED_PSEUDO.test(key)
  );
}

function pseudoSuffix(key: string): string {
  if (PSEUDO_ELEMENTS.has(key)) return `::${kebab(key)}`;
  return `:${kebab(key)}`;
}

function selectorSuffix(key: string): string {
  if (key.includes('&')) return key.replace(/&/g, '');
  return ` ${key}`;
}

/** media/container features object → `(a: 1) and (b: 2)`. */
function featureQuery(features: Record<string, unknown>): string {
  return Object.entries(features)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `(${kebab(k)}: ${String(v)})`)
    .join(' and ');
}

function atRulePrelude(key: string, value: Record<string, unknown>): Prelude {
  if (key === 'media' || key === 'container') {
    const { style: _style, name, ...features } = value;
    const params = featureQuery(features);
    const named = typeof name === 'string' ? `${name} ` : '';
    return { kind: 'atrule', name: key, params: `${named}${params}` };
  }
  if (key === 'supports') {
    const q = value.query;
    const params =
      typeof q === 'object' && q !== null
        ? featureQuery(q as Record<string, unknown>)
        : String(q ?? '');
    return { kind: 'atrule', name: 'supports', params };
  }
  // layer / scope
  const name = typeof value.name === 'string' ? value.name : '';
  return { kind: 'atrule', name: key, params: name };
}

function rangeToMedia(key: string): string {
  const ge = RANGE_GE.exec(key);
  if (ge) return `(width >= ${ge[1]})`;
  const lt = RANGE_LT.exec(key);
  if (lt) return `(width < ${lt[1]})`;
  const between = RANGE_BETWEEN.exec(key);
  if (between) return `(${between[1]} <= width <= ${between[2]})`;
  throw new Error(`invalid value-map key '${key}' — expected 'base', '>=X', '<X', or 'X..Y'`);
}

function isRangeKey(key: string): boolean {
  return RANGE_GE.test(key) || RANGE_LT.test(key) || RANGE_BETWEEN.test(key);
}

function isVarRef(v: unknown): v is VarRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { $$md?: string }).$$md === 'var'
  );
}

function classifyValue(v: unknown): ValueExpr {
  if (isVarRef(v)) return { kind: 'static', text: `var(${v.varName})` };
  if (isMarker(v)) {
    if (v.$$md === 'param') {
      const p: ValueExpr = { kind: 'param', name: v.name, varName: '' };
      if (v.fallback !== undefined) p.fallback = v.fallback;
      return p;
    }
    return {
      kind: 'cond',
      id: v.id,
      when: classifyValue(v.when),
      else: classifyValue(v.else),
    };
  }
  if (typeof v === 'number') return { kind: 'static', text: String(v) };
  if (typeof v === 'string') return { kind: 'static', text: v };
  if (typeof v === 'object' && v !== null) {
    const slots: MapSlot[] = [];
    for (const [k, sv] of Object.entries(v as Record<string, unknown>)) {
      if (sv === undefined || sv === null) continue;
      if (k !== 'base' && !isRangeKey(k)) {
        throw new Error(
          `invalid value-map key '${k}' — expected 'base', '>=X', '<X', or 'X..Y'`,
        );
      }
      if (typeof sv === 'object' && sv !== null && !isMarker(sv) && !isVarRef(sv)) {
        throw new Error(`value maps can't nest — '${k}' holds an object`);
      }
      slots.push({ key: k, value: classifyValue(sv) });
    }
    if (slots.length === 0) throw new Error('empty value map');
    return { kind: 'map', slots };
  }
  throw new Error(`unsupported style value: ${String(v)}`);
}

interface Frame {
  scope: string;
  prelude: Prelude[];
  obj: Record<string, unknown>;
}

export function classify(obj: StyleObject, scope: string): StyleProgram {
  const blocks: Block[] = [];
  const stack: Frame[] = [
    { scope, prelude: [], obj: obj as Record<string, unknown> },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const decls: Decl[] = [];
    const nested: Frame[] = [];

    for (const [key, raw] of Object.entries(frame.obj)) {
      if (raw === undefined || raw === null) continue;
      const isObj = typeof raw === 'object' && raw !== null;

      if (AT_RULE_KEYS.has(key) && isObj && !isMarker(raw) && !isVarRef(raw)) {
        const v = raw as Record<string, unknown>;
        nested.push({
          scope: frame.scope,
          prelude: [...frame.prelude, atRulePrelude(key, v)],
          obj: (v.style ?? {}) as Record<string, unknown>,
        });
      } else if (isPseudo(key) && isObj) {
        nested.push({
          scope: frame.scope,
          prelude: [
            ...frame.prelude,
            { kind: 'selector', suffix: pseudoSuffix(key) },
          ],
          obj: raw as Record<string, unknown>,
        });
      } else if (SELECTOR_START.test(key) && isObj) {
        nested.push({
          scope: frame.scope,
          prelude: [
            ...frame.prelude,
            { kind: 'selector', suffix: selectorSuffix(key) },
          ],
          obj: raw as Record<string, unknown>,
        });
      } else {
        decls.push({ prop: key.startsWith('--') ? key : kebab(key), value: classifyValue(raw) });
      }
    }

    if (decls.length > 0) {
      blocks.push({ scope: frame.scope, prelude: frame.prelude, decls });
    }
    // pop() order = reverse of source order; unshift preserves it.
    for (let i = nested.length - 1; i >= 0; i--) stack.push(nested[i]!);
  }

  const program: StyleProgram = { scope, blocks, variants: [], params: [] };
  collectParams(program);
  return normalize(program);
}

/** Bind param names to scoped var names and record the bindings. */
function collectParams(program: StyleProgram): void {
  const seen = new Set<string>();
  const visit = (v: ValueExpr): void => {
    if (v.kind === 'param') {
      v.varName = `--${program.scope}-${v.name}`;
      if (!seen.has(v.name)) {
        seen.add(v.name);
        program.params.push({ name: v.name, varName: v.varName });
      }
    } else if (v.kind === 'cond') {
      visit(v.when);
      visit(v.else);
    } else if (v.kind === 'map') {
      for (const s of v.slots) visit(s.value);
    }
  };
  for (const b of program.blocks) for (const d of b.decls) visit(d.value);
}

/* ------------------------------------------------------------------ */
/* Lifting: maps → media blocks, conds → variant-class blocks.          */
/* ------------------------------------------------------------------ */

function normalize(program: StyleProgram): StyleProgram {
  let changed = true;
  while (changed) {
    changed = liftMapsOnce(program) || liftCondsOnce(program);
  }
  program.blocks = program.blocks.filter((b) => b.decls.length > 0);
  return program;
}

/** Replace map-valued decls with a base decl + per-range media blocks. */
function liftMapsOnce(program: StyleProgram): boolean {
  let changed = false;
  const out: Block[] = [];

  for (const block of program.blocks) {
    const kept: Decl[] = [];
    const extra: Block[] = [];

    for (const decl of block.decls) {
      if (decl.value.kind !== 'map') {
        kept.push(decl);
        continue;
      }
      changed = true;
      for (const slot of decl.value.slots) {
        if (slot.key === 'base') {
          kept.push({ prop: decl.prop, value: slot.value });
        } else {
          extra.push({
            scope: block.scope,
            prelude: [
              ...block.prelude,
              { kind: 'atrule', name: 'media', params: rangeToMedia(slot.key) },
            ],
            decls: [{ prop: decl.prop, value: slot.value }],
          });
        }
      }
    }

    out.push({ ...block, decls: kept }, ...extra);
  }

  program.blocks = out;
  return changed;
}

/**
 * Replace cond-valued decls with variant-class blocks: one `when` class and
 * one `else` class per distinct condition id. Variant names derive from the
 * scope so they're deterministic.
 */
function liftCondsOnce(program: StyleProgram): boolean {
  let changed = false;
  const out: Block[] = [];

  const variantFor = (id: string): VariantClass => {
    const existing = program.variants.find((v) => v.id === id);
    if (existing) return existing;
    const n = program.variants.length;
    const v: VariantClass = {
      id,
      whenClass: `${program.scope}v${n}t`,
      elseClass: `${program.scope}v${n}f`,
    };
    program.variants.push(v);
    return v;
  };

  for (const block of program.blocks) {
    const kept: Decl[] = [];
    const byCond = new Map<string, { when: Decl[]; else: Decl[] }>();

    for (const decl of block.decls) {
      if (decl.value.kind !== 'cond') {
        kept.push(decl);
        continue;
      }
      changed = true;
      const id = decl.value.id;
      let g = byCond.get(id);
      if (!g) {
        g = { when: [], else: [] };
        byCond.set(id, g);
      }
      g.when.push({ prop: decl.prop, value: decl.value.when });
      g.else.push({ prop: decl.prop, value: decl.value.else });
    }

    out.push({ ...block, decls: kept });
    for (const [id, g] of byCond) {
      const v = variantFor(id);
      out.push(
        { scope: v.whenClass, prelude: block.prelude, decls: g.when },
        { scope: v.elseClass, prelude: block.prelude, decls: g.else },
      );
    }
  }

  program.blocks = out;
  return changed;
}
