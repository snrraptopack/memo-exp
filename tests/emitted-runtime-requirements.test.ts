import { expect, it } from 'bun:test';
import { parseEstreeOrThrow } from '../packages/compiler/src/ast';
import { GeneratedIdentifiers } from '../packages/compiler/src/dom/identifiers';
import { emittedRuntimeHelpers } from '../packages/compiler/src/dom/runtime-requirements';

it('does not retain capabilities from discarded emitter expressions', () => {
  const program = parseEstreeOrThrow('export const n=0;', {filename:'./output.ts'}).program;
  const identifiers = new GeneratedIdentifiers(program);
  identifiers.runtimeMember('materializeMarkup');
  identifiers.runtimeMember('createListRegion');
  expect([...emittedRuntimeHelpers(program, identifiers.runtimeId)]).toEqual([]);
});

it('includes retained future factories, static computed properties and aliases of helpers', () => {
  const program = parseEstreeOrThrow(`
    const factory=()=>_MD.createListRegion();
    const markup=_MD['materializeMarkup'];
    _MD.registerRootFactory('Later',factory);
    const unrelated=host.createPositionalListRegion;
  `, {filename:'./output.ts'}).program;
  expect([...emittedRuntimeHelpers(program, '_MD')].sort())
    .toEqual(['createListRegion','materializeMarkup','registerRootFactory']);
});

it('keeps adoption conservative for unknown generated runtime lookups', () => {
  const program=parseEstreeOrThrow('_MD[helper]();', {filename:'./output.ts'}).program;
  expect([...emittedRuntimeHelpers(program,'_MD')].sort())
    .toEqual(['createListRegion','materializeMarkup']);
});
