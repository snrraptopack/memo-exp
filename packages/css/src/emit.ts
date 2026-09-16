/**
 * emit: StyleProgram → stylesheet text.
 *
 * Blocks are flat — each carries its prelude. Selector preludes append to
 * the scope selector in order; at-rule preludes wrap the rule outermost
 * first. Emission is pure: same program, same text.
 */

import type { Block, StyleProgram, ValueExpr } from './grammar';
import { kebab } from './classify';

function emitValue(v: ValueExpr): string {
  switch (v.kind) {
    case 'static':
      return v.text;
    case 'param':
      return v.fallback !== undefined
        ? `var(${v.varName}, ${v.fallback})`
        : `var(${v.varName})`;
    case 'cond':
      // conds are lifted before emission; seeing one is a bug
      throw new Error('unlifted cond node reached the emitter');
    case 'map':
      throw new Error('unlifted map node reached the emitter');
  }
}

function emitBlock(block: Block): string {
  const selectors = block.prelude
    .filter((p): p is Extract<typeof p, { kind: 'selector' }> => p.kind === 'selector')
    .map((p) => p.suffix)
    .join('');
  const atrules = block.prelude.filter(
    (p): p is Extract<typeof p, { kind: 'atrule' }> => p.kind === 'atrule',
  );

  const body = block.decls
    .map((d) => `${d.prop}: ${emitValue(d.value)};`)
    .join(' ');
  let rule = `.${block.scope}${selectors} { ${body} }`;

  // innermost at-rule wraps first
  for (let i = atrules.length - 1; i >= 0; i--) {
    const a = atrules[i]!;
    rule = `@${a.name}${a.params ? ` ${a.params}` : ''} { ${rule} }`;
  }
  return rule;
}

export function emitProgram(program: StyleProgram): string {
  return program.blocks.map(emitBlock).join('\n');
}

/** keyframes bodies are flat decl objects — no contexts, no maps. */
export function emitKeyframes(name: string, frames: Record<string, Record<string, unknown>>): string {
  const body = Object.entries(frames)
    .map(([frame, decls]) => {
      const text = Object.entries(decls)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k.startsWith('--') ? k : kebab(k)}: ${String(v)};`)
        .join(' ');
      return `${frame} { ${text} }`;
    })
    .join(' ');
  return `@keyframes ${name} { ${body} }`;
}
