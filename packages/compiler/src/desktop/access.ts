/** Adapt shared reader proofs to desktop's persistent scene ownership. */
import { planAccessReaders } from '../analysis/access-table';
import type { Ctx } from '../context';

export function desktopAccessReaders(ctx: Ctx): Record<string, string[]> {
  const compReads = new Map([...ctx.compReads].map(([name, reads]) => [name, new Set(reads)]));
  const include = (owner: string, reads: Iterable<string>): void => {
    let combined = compReads.get(owner);
    if (!combined) compReads.set(owner, combined = new Set());
    for (const read of reads) combined.add(read);
  };

  // Inline fragments share the named closure's state. Its update already
  // reaches its lexical descendants, including inactive/candidate regions.
  // DOM's specialized selection entities do not exist in this host.
  for (const site of ctx.rowReads.values()) include(site.owner, site.vars);
  for (const site of ctx.condReads.values()) include(site.owner, site.vars);
  for (const site of ctx.moduleListSelectionSites) include(site.owner, site.values);
  const linkedComponentPaths = new Map<string, string[]>([...ctx.compPaths.keys()].map(name => {
    const segment = `${encodeURIComponent(`${ctx.moduleId}#${name}`)}[*]`;
    return [name, [`Desktop/${segment}`, `Desktop/**/${segment}`]];
  }));
  const plan = planAccessReaders({
    ...ctx,
    compReads,
    linkedComponentPaths,
    listedSites: new Map(),
    linkedComponentRows: new Map(),
    rowReads: new Map(),
    condReads: new Map(),
    moduleListSelectionSites: [],
  });
  return Object.fromEntries([...plan].map(([key, readers]) => [key, [...readers].sort()]));
}
