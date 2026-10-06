/** One backend binding per owner/source, shared by handlers and list emission. */
import type { Ctx, KeyedListMutationPlan } from '../context';
import { generatedIdentifier } from '../identifiers';

export interface EmittedMutationJournal extends KeyedListMutationPlan {
  readonly keysVariable: string;
}

const bindings = new WeakMap<Ctx, Map<string, string>>();

export function mutationJournalVariable(ctx: Ctx, owner: string, source: string): string {
  let variables = bindings.get(ctx);
  if (variables === undefined) { variables = new Map(); bindings.set(ctx, variables); }
  const key = `${owner}\0${source}`;
  let variable = variables.get(key);
  if (variable === undefined) {
    variable = generatedIdentifier(ctx, `${source}ChangedKeys`).name;
    variables.set(key, variable);
  }
  return variable;
}
