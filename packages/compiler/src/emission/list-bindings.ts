/** Backend list bindings shared by factory, handler and region emission. */
import type { Ctx, KeyedListMutationPlan } from '../context';
import { generatedIdentifier } from '../identifiers';

export interface EmittedMutationJournal extends KeyedListMutationPlan {
  readonly keysVariable: string;
}

const bindings = new WeakMap<Ctx, Map<string, string>>();

function listBinding(ctx: Ctx, owner: string, source: string, kind: string, hint: string): string {
  let variables = bindings.get(ctx);
  if (variables === undefined) { variables = new Map(); bindings.set(ctx, variables); }
  const key = `${kind}\0${owner}\0${source}`;
  let variable = variables.get(key);
  if (variable === undefined) {
    variable = generatedIdentifier(ctx, `${source}${hint}`).name;
    variables.set(key, variable);
  }
  return variable;
}

export function mutationJournalVariable(ctx: Ctx, owner: string, source: string): string {
  return listBinding(ctx, owner, source, 'journal', 'ChangedKeys');
}

export function listProvenanceVariable(ctx: Ctx, owner: string, source: string): string {
  return listBinding(ctx, owner, source, 'provenance', 'Provenance');
}
