/** DOM backend allocation for external subscription adapters. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type {DomContext as Ctx} from './context';
import {generatedIdentifier} from './identifiers';

export function externalSubscriptionBinding(ctx:Ctx,source:string):string {
  const subscribe=ctx.externalReactiveBindings.get(source);
  if(subscribe===undefined)throw new Error('memo-dom: missing external subscription contract');
  const key=subscribe.module+'\0'+subscribe.export;
  let adapter=ctx.externalReactiveImports.get(key);
  if(adapter===undefined){
    adapter={module:subscribe.module,imported:subscribe.export,local:generatedIdentifier(ctx,'subscribeExternal').name};
    ctx.externalReactiveImports.set(key,adapter);
  }
  return adapter.local;
}
export function allocateExternalSubscriptions(ctx:Ctx):void {
  for(const source of ctx.externalReactiveBindings.keys())externalSubscriptionBinding(ctx,source);
}

/** Imports required only by live external bindings actually used in a file. */
export function externalReactiveImportStatements(ctx: Ctx): t.ImportDeclaration[] {
  return [...ctx.externalReactiveImports.values()].map(adapter =>
    astFactory.importDeclaration(
      [
        astFactory.importSpecifier(
          astFactory.identifier(adapter.local),
          astFactory.identifier(adapter.imported),
        ),
      ],
      astFactory.stringLiteral(adapter.module),
    ),
  );
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
