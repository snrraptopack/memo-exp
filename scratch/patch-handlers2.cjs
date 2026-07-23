const fs = require('fs');
const p = 'compiler/handlers.ts';
const src = fs.readFileSync(p, 'utf8');
const hasCRLF = src.includes('\r\n');
const norm = src.replace(/\r\n/g, '\n');
const anchor = [
  "  for (const site of ctx.condReads.values()) {",
  "    if (site.vars.has(v)) out.add('__regions__'); // region-updated, not owner-updated",
  '  }',
  '  return out;',
  '}',
].join('\n');
const addition = [
  '',
  '/**',
  ' * R11.1: can anything OTHER than the row\x27s own list observe item-field',
  ' * mutations? The row-local commit (markDirty/update on the row alone) is',
  ' * sound only when the answer is no. List owners are excluded — their',
  ' * map-source read is inherent to the list pattern and the reconcile',
  ' * resyncs their rows (see spec §11.3 for the residual case of an owner',
  ' * deriving item fields inline, outside a computed).',
  ' */',
  'function itemFieldVisibleBeyondList(',
  '  ctx: Ctx,',
  '  compName: string | null,',
  '  rowCtx: RowCtx,',
  '): boolean {',
  '  const arr = rowCtx.arrayName;',
  '  if (arr === \x27\x27) return true; // unknown source array → conservative',
  '  for (const info of ctx.computeds.values()) {',
  '    if (info.reads.has(arr)) return true;',
  '  }',
  '  const owners = new Set((ctx.listedSites.get(compName ?? \x27\x27) ?? []).map((s) => s.owner));',
  '  if (owners.size === 0 && compName !== null) owners.add(compName); // inline rows',
  '  for (const reader of readersOfVar(ctx, arr)) {',
  "    if (reader === '__rows__' || reader === '__regions__') return true;",
  '    if (!owners.has(reader)) return true;',
  '  }',
  '  return false;',
  '}',
].join('\n');
if (norm.split(anchor).length !== 2) {
  console.error('anchor count:', norm.split(anchor).length - 1);
  process.exit(1);
}
let out = norm.replace(anchor, anchor + addition);
if (hasCRLF) out = out.replace(/\n/g, '\r\n');
fs.writeFileSync(p, out);
console.log('helper added');
