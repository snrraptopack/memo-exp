/**
 * The authoring surface: css(), style(), vars(), keyframes().
 *
 * Interpreted-mode semantics: style functions evaluate eagerly at the call
 * site and each distinct argument combination specializes into its own
 * class — the same thing the compiler emits for literal args. The compiled
 * mode (later) rewrites call sites to var bindings / variant toggles using
 * the program's params/variants manifest; the emitted CSS is identical in
 * shape either way.
 */

import { classify } from './classify';
import { emitKeyframes } from './emit';
import { hashString, stableStringify } from './hash';
import { registerProgram, registerRaw } from './registry';
import type { StyleObject, StyleRef, StyledFn, VarRef } from './types';

/** Placeholder scope — registerProgram renames to the content hash. */
const SCOPE = 'm';

function makeRef(scope: string): StyleRef {
  // toString is non-enumerable so {...ref} only spreads `class`/`style`.
  const ref = { class: scope } as StyleRef;
  Object.defineProperty(ref, 'toString', {
    value: () => scope,
    enumerable: false,
  });
  return ref;
}

/**
 * Static: css(object) → StyleRef.
 * Dynamic: css(($) => object) → (params) => StyleRef.
 *
 * One signature on purpose: the union parameter keeps the arrow function
 * contextually typed, so '50%' checks against Percentage instead of
 * widening to string (overloads break that). Params should use the
 * vocabulary types — `Length`, `Color`, `Percentage`, … — so values like
 * `width: $.size` typecheck and call sites validate literals.
 */
export function css<I extends StyleObject | (($: any) => StyleObject)>(
  input: I,
): I extends ($: infer P) => StyleObject ? StyledFn<P> : StyleRef {
  if (typeof input === 'function') {
    return ((params: unknown) =>
      makeRef(
        registerProgram(
          classify((input as (p: unknown) => StyleObject)(params ?? {}), SCOPE),
        ),
      )) as never;
  }
  return makeRef(registerProgram(classify(input, SCOPE))) as never;
}

/**
 * A style fragment — the compositional unit. Fragments are uncompiled:
 * they only become CSS when spread into a css()/style() body. Fragment
 * functions take explicit args like any function.
 */
export function style<I extends StyleObject | (($: any) => StyleObject)>(
  input: I,
): I extends ($: infer P) => StyleObject ? (args: P) => StyleObject : StyleObject {
  return input as never;
}

export type VarsResult<D> = { class: string } & {
  [K in keyof D]: VarRef<D[K]>;
};

/**
 * Scoped custom properties. Returns a class that declares the vars plus a
 * typed VarRef per key — usable as a style value (emits `var(--x)`) and in
 * string interpolation.
 */
export function vars<D extends Record<string, string | number>>(
  def: D,
): VarsResult<D> {
  const scope = `m${hashString(stableStringify(def))}`;
  const decls = Object.entries(def)
    .map(([k, v]) => `--${scope}-${k}: ${String(v)};`)
    .join(' ');
  registerRaw(`vars:${scope}`, `.${scope} { ${decls} }`);

  const result: Record<string, unknown> = { class: scope };
  for (const k of Object.keys(def)) {
    const varName = `--${scope}-${k}` as `--${string}`;
    result[k] = {
      $$md: 'var',
      varName,
      toString: () => `var(${varName})`,
    } satisfies VarRef;
  }
  return result as VarsResult<D>;
}

/**
 * A named animation → hashed name, usable in `animation`/template strings.
 * Frames are flat decl objects: { from, to } or { '50%': {...} }.
 */
export function keyframes(
  frames: Record<string, Record<string, string | number>>,
): string {
  const name = `m${hashString(stableStringify(frames))}`;
  registerRaw(`keyframes:${name}`, emitKeyframes(name, frames));
  return name;
}
