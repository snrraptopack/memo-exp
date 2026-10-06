import { expect, it } from 'vitest';
import { cloneNode, parseEstreeOrThrow, printEstree, walkAst } from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import { createCtx } from '../packages/compiler/src/context';
import { prepareProgramAnalysis } from '../packages/compiler/src/analysis/prepare';
import {
  collectComponentItemWrites,
  planListMutationCandidate,
} from '../packages/compiler/src/analysis/list-mutation-journals';
import { directItemWrite } from '../packages/compiler/src/lists/item-write';
import { directListItemMutationKey } from '../packages/compiler/src/handlers/mutation-targets';
import { matchMapCall } from '../packages/compiler/src/lists/source-shapes';
import { planComponentListSites } from '../packages/compiler/src/planning/list-sites';
import { mutationJournalVariable } from '../packages/compiler/src/emission/mutation-journals';

function parse(source: string): t.Program {
  return parseEstreeOrThrow(source, { filename: './mutation-plan.tsx' }).program as unknown as t.Program;
}
function expression(source: string): t.Expression {
  return (parse(`const value = (${source});`).body[0] as t.VariableDeclaration).declarations[0]!.init!;
}
function component(body: string): t.FunctionDeclaration {
  return parse(`function View() { ${body} }`).body[0] as t.FunctionDeclaration;
}
const site = {
  sourceLocal: true,
  sourceExpr: expression('items'),
  keyExpr: expression('item.id'),
  itemParam: 'item',
};

it.each([
  ['items[index].label', ['label']],
  ['items[0]["label"]', ['label']],
  ['(items[index] as Item).details.label', ['details', 'label']],
] as const)('shares the authored indexed-item shape without mutating it: %s', (source, path) => {
  const member = expression(source) as t.MemberExpression;
  const before = JSON.stringify(member);
  const write = directItemWrite(member)!;
  expect(write.source).toBe('items');
  expect(write.path).toEqual(path);
  expect(JSON.stringify(member)).toBe(before);
  // The handler builds its key only after its separate plain-data proof.
  const key = directListItemMutationKey(member, {
    source: 'items', keyPath: ['id'], targetedReason: 'content',
    structuralReason: 'structure', call: expression('items.map(item => <li/>)') as t.CallExpression,
  });
  expect(printEstree(key!).code).toMatch(/items\[(?:index|0)\].id/);
  expect(JSON.stringify(member)).toBe(before);
});

it.each([
  'items.label', 'items[index]', 'items[next()].label', 'items[index][field]',
  'items[index].children[0].label', 'props.items[index].label',
])('keeps uncertain or non-indexed item shapes out of the direct journal: %s', source => {
  expect(directItemWrite(expression(source) as t.MemberExpression)).toBeNull();
});

it('collects assignment, update and deletion candidates once, with no source mutation or key evaluation', () => {
  const node = component(`items[0].label = 'new'; items[index].count++;
    delete other[0].label; const later = () => { items[1].details.text = 'next'; };`);
  const before = JSON.stringify(node);
  const writes = collectComponentItemWrites(node);
  expect(JSON.stringify(node)).toBe(before);
  expect(writes.hasNonKeyWrite('items', ['id'])).toBe(true);
  expect(writes.hasNonKeyWrite('other', ['id'])).toBe(true);
  expect(writes.hasNonKeyWrite('missing', ['id'])).toBe(false);
  expect(planListMutationCandidate(site, new Set(['items']), writes)).toEqual({ source: 'items', keyPath: ['id'] });
  // Captured paths do not re-read a factory which emission has replaced.
  node.body.body = [];
  expect(writes.hasNonKeyWrite('items', ['id'])).toBe(true);
});

it('keeps key-only writes and replacements out of content targeting', () => {
  const node = component('items[0].id++; items[0] = next; items[0].identity = next;');
  const writes = collectComponentItemWrites(node);
  expect(writes.hasNonKeyWrite('items', ['identity', 'id'])).toBe(true); // id is a different field
  const keyOnly = collectComponentItemWrites(component('items[0].identity = next;'));
  expect(planListMutationCandidate({ ...site, keyExpr: expression('item.identity.id') }, new Set(['items']), keyOnly)).toBeNull();
  const idOnly = collectComponentItemWrites(component('items[0].id++; items[0] = next;'));
  expect(planListMutationCandidate(site, new Set(['items']), idOnly)).toBeNull();
});

it('requires owned state and a direct nonempty key path, retaining spread/derived fallbacks', () => {
  const writes = collectComponentItemWrites(component('items[0].label = next;'));
  const owned = new Set(['items']);
  expect(planListMutationCandidate(site, new Set(), writes)).toBeNull();
  expect(planListMutationCandidate({ ...site, sourceLocal: false }, owned, writes)).toBeNull();
  expect(planListMutationCandidate({ ...site, sourceExpr: expression('props.items') }, owned, writes)).toBeNull();
  for (const keyExpr of [null, expression('item'), expression('keyOf(item)'), expression('({...item}).key')]) {
    expect(planListMutationCandidate({ ...site, keyExpr }, owned, writes)).toBeNull();
  }
});

it('does not request an owner-wide candidate scan for an ineligible list', () => {
  const writes = { hasNonKeyWrite() { throw new Error('unexpected candidate scan'); } };
  const owned = new Set(['items']);
  expect(planListMutationCandidate({ ...site, sourceLocal: false }, owned, writes)).toBeNull();
  expect(planListMutationCandidate(site, new Set(), writes)).toBeNull();
  expect(planListMutationCandidate({ ...site, keyExpr: expression('keyOf(item)') }, owned, writes)).toBeNull();
});

function prepared(twoLists = false) {
  const program = parse(`function View() {
    let items = [{ id: 1, label: 'one' }];
    return <main><ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
      ${twoLists ? '<ol>{items.map(item => <li key={item.id}>{item.label}</li>)}</ol>' : ''}
      <button onClick={() => { items[0].label = 'new'; }}/> </main>;
  }`);
  const ctx = createCtx();
  prepareProgramAnalysis(ctx, { node: program, buildCodeFrameError: message => new Error(message) });
  const calls: t.CallExpression[] = [];
  walkAst(program, { enter(node) {
    const call = matchMapCall(node);
    if (call !== null) calls.push(call as t.CallExpression);
  }});
  return { program, ctx, calls };
}

it('captures immutable journal facts by original call identity before mutable context is consumed', () => {
  const { program, ctx, calls } = prepared();
  const before = JSON.stringify(program), headers = [...ctx.header];
  const original = ctx.keyedListMutationSources.get('View')!.get('items')!;
  const plan = planComponentListSites(ctx).get('View')!;
  const journal = plan.mutationFor(calls[0]!)!;
  expect(journal).toEqual(original);
  expect(journal).not.toHaveProperty('keysVariable');
  expect(journal).not.toBe(original);
  expect(journal.keyPath).not.toBe(original.keyPath);
  expect(Object.isFrozen(journal)).toBe(true);
  expect(Object.isFrozen(journal.keyPath)).toBe(true);
  expect(JSON.stringify(program)).toBe(before);
  expect(ctx.header).toEqual(headers);
  ctx.keyedListMutationSources.clear();
  (original.keyPath as string[]).push('changed');
  ctx.instanceState.clear();
  expect(plan.mutationFor(calls[0]!)!.keyPath).toEqual(['id']);
  expect(plan.mutationFor(cloneNode(calls[0]!))).toBeUndefined();
});

it('allocates shared backend variables without adding generated bindings to semantic facts',()=>{
  const {ctx,calls}=prepared();
  const journal=planComponentListSites(ctx).get('View')!.mutationFor(calls[0]!)!;
  const before=JSON.stringify(journal);
  const variable=mutationJournalVariable(ctx,'View',journal.source);
  expect(mutationJournalVariable(ctx,'View',journal.source)).toBe(variable);
  expect(mutationJournalVariable(ctx,'Other',journal.source)).not.toBe(variable);
  expect(JSON.stringify(journal)).toBe(before);
});

it('disables an independently consumed journal when two list regions use the same source', () => {
  const { ctx, calls } = prepared(true);
  expect(ctx.disabledKeyedListMutationSources.has('View\0items')).toBe(true);
  const plan = planComponentListSites(ctx).get('View')!;
  expect(calls).toHaveLength(2);
  expect(calls.map(call => plan.mutationFor(call))).toEqual([undefined, undefined]);
});
