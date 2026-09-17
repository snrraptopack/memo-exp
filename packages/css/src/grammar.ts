/**
 * The style IR — the "grammar" of the language.
 *
 * Every style object is classified into a StyleProgram: a flat list of
 * blocks, each a prelude (selector/at-rule context) plus declarations whose
 * values are ValueExpr nodes. The dynamic surface is explicit:
 *
 *   static   → literal text
 *   param    → a hole the call site fills → `var(--scope-name)`
 *   cond     → a finite choice            → variant classes
 *   map      → a responsive piecewise fn  → base + media rules
 *
 * Interpreted mode (today) resolves functions eagerly, so programs it
 * builds contain only static/map nodes. The compiler produces param/cond
 * nodes directly — emission already handles them.
 */

export type ValueExpr =
  | { kind: 'static'; text: string }
  | { kind: 'param'; name: string; varName: string; fallback?: string }
  | { kind: 'cond'; id: string; when: ValueExpr; else: ValueExpr }
  | { kind: 'map'; slots: MapSlot[] };

export interface MapSlot {
  /** 'base' or a viewport-width range key: '>=40rem', '<30rem', '20rem..40rem'. */
  key: string;
  value: ValueExpr;
}

export interface Decl {
  prop: string;
  value: ValueExpr;
}

/** One context step, outermost-first. */
export type Prelude =
  /** Appended to the scope selector: ':hover', ' .icon', '.active'. */
  | { kind: 'selector'; suffix: string }
  /** Wraps the rule: { name: 'media', params: '(width >= 40rem)' }. */
  | { kind: 'atrule'; name: string; params: string };

export interface Block {
  /** Class name this block's declarations live under. */
  scope: string;
  prelude: Prelude[];
  decls: Decl[];
}

/** A conditional pair of classes — the compiler toggles between them. */
export interface VariantClass {
  id: string;
  whenClass: string;
  elseClass: string;
}

/** A dynamic value hole — bound inline as `style="--x: …"`. */
export interface ParamBinding {
  name: string;
  varName: string;
}

export interface StyleProgram {
  /** Base class name, content-hash derived: 'm1a2b'. */
  scope: string;
  blocks: Block[];
  variants: VariantClass[];
  params: ParamBinding[];
}

/* ------------------------------------------------------------------ */
/* Markers — the compiler-facing way to put param/cond/var nodes into   */
/* a style object. Runtime resolution never produces them; tests and    */
/* the future compiler hook do.                                        */
/* ------------------------------------------------------------------ */

export interface ParamMarker {
  readonly $$md: 'param';
  readonly name: string;
  readonly fallback?: string;
}

export interface CondMarker {
  readonly $$md: 'cond';
  readonly id: string;
  readonly when: unknown;
  readonly else: unknown;
}

export type Marker = ParamMarker | CondMarker;

/** Declare a dynamic value hole. Lowered to `var(--scope-name, fb?)`. */
export function param(name: string, fallback?: string): ParamMarker {
  return { $$md: 'param', name, fallback };
}

/**
 * Declare a conditional: `id` identifies the condition (e.g. 'active' or
 * 'variant===primary'); `when`/`else` are the two possible values.
 * Lowered to a variant class pair.
 */
export function cond(id: string, when: unknown, otherwise: unknown): CondMarker {
  return { $$md: 'cond', id, when, else: otherwise };
}

export function isMarker(v: unknown): v is Marker {
  return (
    typeof v === 'object' &&
    v !== null &&
    ((v as { $$md?: string }).$$md === 'param' ||
      (v as { $$md?: string }).$$md === 'cond')
  );
}
