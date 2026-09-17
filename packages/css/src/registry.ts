/**
 * The stylesheet registry: programs are registered once by content hash
 * (same input → same scope → dedupe for free) and collected into a single
 * stylesheet in insertion order.
 *
 * `getCssText()` is the build-time artifact path — SSR and extraction both
 * read it. `mountStyles()` is the interpreted-mode browser path.
 */

import { hashString, stableStringify } from './hash';
import { emitProgram } from './emit';
import type { StyleProgram } from './grammar';

const emitted = new Map<string, string>();
const order: string[] = [];

/** Serialize a program's blocks canonically — the scope hash's input. */
export function programSignature(program: StyleProgram): string {
  return stableStringify({
    blocks: program.blocks,
    variants: program.variants,
    params: program.params,
  });
}

/**
 * Register a program: hash its content into the scope name, rewrite the
 * scope (and everything derived from it) to that name, emit, dedupe.
 * Returns the scope — which IS the class name.
 */
export function registerProgram(program: StyleProgram): string {
  const scope = `m${hashString(programSignature(program))}`;
  if (emitted.has(scope)) return scope;
  emitted.set(scope, emitProgram(renameScope(program, scope)));
  order.push(scope);
  return scope;
}

/** The program's scope is decided by its content, so rename post-hoc. */
function renameScope(program: StyleProgram, scope: string): StyleProgram {
  const renameVar = (n: string) => n.replace(`--${program.scope}-`, `--${scope}-`);
  return {
    scope,
    blocks: program.blocks.map((b) => ({
      ...b,
      scope:
        b.scope === program.scope
          ? scope
          : b.scope.replace(program.scope, scope),
      decls: b.decls.map((d) =>
        d.value.kind === 'param'
          ? { ...d, value: { ...d.value, varName: renameVar(d.value.varName) } }
          : d,
      ),
    })),
    variants: program.variants.map((v) => ({
      ...v,
      whenClass: v.whenClass.replace(program.scope, scope),
      elseClass: v.elseClass.replace(program.scope, scope),
    })),
    params: program.params.map((p) => ({ ...p, varName: renameVar(p.varName) })),
  };
}

/** Register raw stylesheet text that isn't a class rule (keyframes). */
export function registerRaw(id: string, text: string): void {
  if (emitted.has(id)) return;
  emitted.set(id, text);
  order.push(id);
}

/** The collected stylesheet, in insertion order. */
export function getCssText(): string {
  return order.map((k) => emitted.get(k)!).join('\n');
}

/** Test/dev helper — drop everything. */
export function clearRegistry(): void {
  emitted.clear();
  order.length = 0;
}

/**
 * Interpreted-mode browser path: inject/update a single <style> tag.
 * Idempotent — safe to call after every css() invocation in dev.
 */
export function mountStyles(doc: Document = document): HTMLStyleElement {
  let el = doc.querySelector<HTMLStyleElement>('style[data-memoized-css]');
  if (!el) {
    el = doc.createElement('style');
    el.setAttribute('data-memoized-css', '');
    doc.head.appendChild(el);
  }
  el.textContent = getCssText();
  return el;
}
