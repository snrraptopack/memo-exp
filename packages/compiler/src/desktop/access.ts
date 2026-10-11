/** Adapt shared reader proofs to desktop's persistent scene ownership. */
import { planAccessReaders, type AccessReaderPlan } from '../analysis/access-table';
import type { Ctx } from '../context';

export function planDesktopAccessReaders(ctx: Ctx): AccessReaderPlan {
  // Inline fragments share the named closure's state. Its update already
  // reaches its lexical descendants, including inactive/candidate regions.
  // DOM's specialized selection entities do not exist in this host.
  return planAccessReaders(ctx, {
    collapseRegionReads: true,
    componentPatterns(name) {
      const segment = `${encodeURIComponent(`${ctx.moduleId}#${name}`)}[*]`;
      return [`Desktop/${segment}`, `Desktop/**/${segment}`];
    },
  });
}

export function desktopAccessReaders(ctx: Ctx): Record<string, string[]> {
  const plan = planDesktopAccessReaders(ctx);
  return Object.fromEntries([...plan].map(([key, readers]) => [key, [...readers].sort()]));
}
