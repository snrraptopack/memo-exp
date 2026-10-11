/** DOM backend allocation for external subscription adapters. */
import type * as t from '../ast/compiler-types';
import { allocateSubscriptionImport, subscriptionImports } from '../emission/external-reactivity';
import type { DomContext as Ctx } from './context';
import { generatedIdentifier } from './identifiers';

export function externalSubscriptionBinding(ctx: Ctx, source: string): string {
  const subscribe = ctx.externalReactiveBindings.get(source);
  if (subscribe === undefined) throw new Error('memo-dom: missing external subscription contract');
  return allocateSubscriptionImport(ctx.externalReactiveImports, subscribe, (name) =>
    generatedIdentifier(ctx, name),
  );
}
export function allocateExternalSubscriptions(ctx: Ctx): void {
  for (const source of ctx.externalReactiveBindings.keys())
    externalSubscriptionBinding(ctx, source);
}

/** Imports required only by live external bindings actually used in a file. */
export function externalReactiveImportStatements(ctx: Ctx): t.ImportDeclaration[] {
  return subscriptionImports(ctx.externalReactiveImports);
}

/** Import the selector adapter only in modules that emit selected route reads. */
export function selectedRouteSubscriptionBinding(ctx: Ctx): string {
  const key = '@memoized-dom/router/internal\0subscribeRouteSelectedValue';
  let adapter = ctx.externalReactiveImports.get(key);
  if (adapter === undefined) {
    adapter = {
      module: '@memoized-dom/router/internal',
      imported: 'subscribeRouteSelectedValue',
      local: generatedIdentifier(ctx, 'subscribeRouteSelectedValue').name,
    };
    ctx.externalReactiveImports.set(key, adapter);
  }
  return adapter.local;
}
